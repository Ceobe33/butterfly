'use strict'

/**
 * 跨文章引用：在源文章里用锚点圈出一段，在别的文章里引进来，避免整段复制。
 *
 * 源文章（锚点行不会出现在页面上）：
 *
 *   <!-- #region erp -->
 *   这里是被引用的内容，markdown 写法照常
 *   <!-- #endregion erp -->
 *
 *   <!-- begin erp --> / <!-- end erp --> 也认，二选一
 *
 * 引用文章：
 *
 *   {% inc 21同事如何相处？/在职场中，该如何处理与同事之间的关系#erp %}
 *   {% inc "21同事如何相处？/在职场中，该如何处理与同事之间的关系" erp %}
 *   {% include_block 同上#erp %}     ← 长写法，等价
 *
 * 路径相对 source/_posts，找不到再按 source 和站点根目录找；
 * 不写扩展名会自动补 .md / .markdown。
 *
 * 引用点和被引用内容写了同一个 `key: value`（如 echarts 围栏里的 title）时，
 * 以引用点之后那次为准：键留在原位，值换成后面的，被引用的旧行就地覆盖、不产生重复行。
 *
 * 为什么是 before_post_render 的 filter、而不是 hexo tag：
 * tag 在 markdown 渲染之后才展开，被引用内容里的 ```echarts 围栏就赶不上围栏过滤器了。
 * 这里 priority 5，排在 echarts-fence（priority 8）之前，引入的是原始 markdown，
 * 文章、表格、围栏都会照常走各自的处理流程。
 */

const fs = require('fs')
const path = require('path')

const MAX_ROUNDS = 3 // 允许 A 引 B、B 引 C 这种链式引用

const START_ALIASES = ['#region', 'begin']
const END_ALIASES = ['#endregion', 'end']

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const anchorRe = (names, label) =>
  new RegExp(`<!--\\s*(?:${names.map(escapeRe).join('|')})[\\s:]+${escapeRe(label)}\\s*-->`, 'i')

const unquote = (text) => String(text).replace(/^["']|["']$/g, '').trim()

/** 去掉 front-matter，只留正文 */
function stripFrontMatter(text) {
  return String(text).replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/** 取出 <!-- #region 名字 --> 与 <!-- #endregion 名字 --> 之间的内容 */
function readRegion(text, label) {
  const open = anchorRe(START_ALIASES, label).exec(text)
  if (!open) return null

  const rest = text.slice(open.index + open[0].length)
  const close = anchorRe(END_ALIASES, label).exec(rest)
  if (!close) return null

  return rest.slice(0, close.index).trim()
}

/**
 * 把 "路径" 解析成磁盘上的文件；相对 source/_posts，再退到 source 和站点根。
 * 没写扩展名时自动补 .md / .markdown，写 `文章/标题#锚点` 就行，不用打 .md。
 */
function resolveTarget(spec) {
  const clean = String(spec).replace(/^\/+/, '')
  const names = path.extname(clean) ? [clean] : [`${clean}.md`, `${clean}.markdown`, clean]

  const bases = [
    path.join(hexo.source_dir, '_posts'),
    hexo.source_dir,
    hexo.base_dir
  ]

  for (const base of bases) {
    for (const name of names) {
      const file = path.join(base, name)

      try {
        if (fs.statSync(file).isFile()) return file
      } catch (err) {
        /* 继续找下一个候选 */
      }
    }
  }

  return null
}

/** 找不到时留一段显眼的提示，而不是让构建悄悄缺内容 */
function missingNotice(what) {
  hexo.log.warn(`[include_block] ${what}`)
  return `\n> ⚠️ include_block: ${what}\n\n`
}

const TAG_RE = () => /\{%-?\s*(?:include_block|inc)\s+("[^"]+"|'[^']+'|\S+)(?:\s+("[^"]+"|'[^']+'|[\w-]+))?\s*-?%\}/g

/* 展开时临时圈出被引用的内容，合并完重复键就抹掉 */
const INC_OPEN = '<!--#inc-open#-->'
const INC_CLOSE = '<!--#inc-close#-->'

const DIRECTIVE = /^([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/
const FENCE = /(^|\n)([ \t]*)(`{3,})([^\n]*)\n([\s\S]*?)\n\2\3[ \t]*(?=\n|$)/g

/**
 * 围栏里重复的 `key: value` 以后者为准：键留在第一次出现的位置，值换成后面的，
 * 后面那次出现的行删掉。
 * 位置不动是为了配合 echarts 那种只认表格前指令行的解析器——放到表格后面就读不到了。
 */
function mergeDirectiveLines(body) {
  const lines = body.split('\n')
  const slots = new Map() // 小写键 -> { index, rawKey }
  const values = new Map() // 小写键 -> 最后写的值
  const drop = new Set()

  lines.forEach((line, index) => {
    const hit = DIRECTIVE.exec(line.trim())
    if (!hit) return

    const key = hit[1].toLowerCase()

    if (slots.has(key)) drop.add(index)
    else slots.set(key, { index, rawKey: hit[1], indent: /^\s*/.exec(line)[0] })

    values.set(key, hit[2])
  })

  slots.forEach((slot, key) => {
    lines[slot.index] = `${slot.indent}${slot.rawKey}: ${values.get(key)}`
  })

  return lines.filter((line, index) => !drop.has(index)).join('\n')
}

/** 只处理带引用的围栏，别动普通代码块 */
function mergeIncludedBlocks(content) {
  return content.replace(FENCE, (raw, lead, indent, fence, info, body) => {
    if (!body.includes(INC_OPEN)) return raw

    const merged = mergeDirectiveLines(body)
    return `${lead}${indent}${fence}${info}\n${merged}\n${indent}${fence}`
  })
}

hexo.extend.filter.register('before_post_render', (data) => {
  let content = String(data.content || '')

  // 1. 展开引用（多轮，支持链式）
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let replaced = false

    content = content.replace(TAG_RE(), (raw, first, second) => {
      replaced = true

      const target = unquote(first)
      let spec = target
      let label = second ? unquote(second) : ''

      if (!label) {
        const hash = target.lastIndexOf('#')
        if (hash < 0) {
          return missingNotice(`缺少锚点: ${raw}`)
        }
        spec = target.slice(0, hash)
        label = target.slice(hash + 1)
      }

      const file = resolveTarget(spec)
      if (!file) return missingNotice(`找不到文件: ${spec}`)

      let source
      try {
        source = stripFrontMatter(fs.readFileSync(file, 'utf8'))
      } catch (err) {
        return missingNotice(`读不了 ${spec}: ${err.message}`)
      }

      const region = readRegion(source, label)
      if (region === null) {
        // 别在提示里写出锚点本身，否则会被下面的清理规则一并删掉
        return missingNotice(`${path.basename(spec)} 里没有锚点 "${label}"，请在源文章里用 #region ${label} / #endregion ${label} 圈出要引用的内容`)
      }

      return `\n${INC_OPEN}${region}${INC_CLOSE}\n`
    })

    if (!replaced) break
  }

  // 2. 引用点后面又写了同名键时以后者为准（围栏内合并，再抹掉临时标记）
  content = mergeIncludedBlocks(content).split(INC_OPEN).join('').split(INC_CLOSE).join('')

  // 3. 锚点只服务于引用，别让它出现在正文里
  content = content
    .replace(new RegExp(`<!--\\s*(?:${START_ALIASES.concat(END_ALIASES).map(escapeRe).join('|')})[\\s:]+[\\w-]+\\s*-->(\\r?\\n)?`, 'gi'), '')
    .replace(/\n{3,}/g, '\n\n')

  data.content = content
  return data
}, 5)
