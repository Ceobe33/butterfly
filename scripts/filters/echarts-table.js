'use strict'

/**
 * Markdown 表格 -> ECharts option。
 *
 * 围栏体除了写 JSON，也可以直接写表格，这样数据只有一份：
 *
 *   ```echarts
 *   height: 420
 *   | 维度 | 对手R | 敌人E | 伙伴P |
 *   | --- | --- | --- | --- |
 *   | 极限 | 5 | 5 | 5 |
 *   | 强度 | 1 | 2 | 4 |
 *   ```
 *
 * 规则：
 * - 只写表格就是雷达图（表格是这个站的主要用法），要别的图形再加 `type: bar|line|pie`
 * - 表格前的 `key: value` 行是指令：`type`（radar / bar / line / pie，默认 radar）、`height`、
 *   `title` / `subtitle`（标题与副标题）、`colors`（按系列顺序覆盖配色，如 `colors: #E60000, #A9C9E8`）、
 *   radar 的 `radius`、`center`（如 `center: 50%, 50%`）与 `shape`（circle / polygon，默认 polygon）
 * - radar 里行名为 `max` / `min` 的行是每根轴的量程，不当系列画；没写 max 就按该列最大值取
 * - 表头取"第一行全数字之前、最后一个非全数字行"，所以像
 *   `| 伙伴型同事 | （P型） |` + `| 维度 | 对手R | 敌人E | 伙伴P |` 这种两行表头也能认
 * - 表头第一列是行名，其余列是维度/分类；每个数据行 = 一个系列，行名即系列名
 * - 数值允许千分位逗号和百分号，`5` / `1,200` / `35%` 都会转成数字
 *
 * 构建期由 scripts/filters/echarts-fence.js 调用，编辑器用同一份做预览，避免两边实现跑偏。
 */

const DIRECTIVE = /^([a-zA-Z_]+)\s*:\s*(.+)$/
const SEPARATOR = /^:?-{2,}:?$/
const PALETTE = ['#4BACC6', '#E60000', '#A9C9E8', '#F79646', '#9BBB59', '#8064A2']

/** 围栏体里是否有表格行（用来把"不是 JSON"的围栏分成表格和其它两种） */
function isTableFence (text) {
  return String(text || '').split('\n').some(line => /^\s*\|/.test(line))
}

/** 表格前面的 `type: radar` 之类 */
function readDirectives (lines) {
  const out = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    if (!line) {
      i++
      continue
    }

    const hit = DIRECTIVE.exec(line)
    if (!hit) break

    out[hit[1].toLowerCase()] = hit[2].trim()
    i++
  }

  return { directives: out, rest: lines.slice(i) }
}

function readRows (lines) {
  const rows = []

  lines.forEach((line) => {
    const text = line.trim()
    if (!text.startsWith('|')) return

    const cells = text.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    if (cells.every(cell => cell === '' || SEPARATOR.test(cell))) return

    rows.push(cells)
  })

  return rows
}

function toNumber (cell) {
  const text = String(cell == null ? '' : cell).replace(/[,%\s]/g, '')
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null
}

function valuesOf (row) {
  return row.slice(1).map(toNumber)
}

/** A row is data when every cell after the first parses as a number */
function isDataRow (row) {
  const values = valuesOf(row)
  return values.length > 0 && values.every(value => value !== null)
}

function buildOption (directives, rows) {
  if (rows.length < 2) return null

  const firstData = rows.findIndex(isDataRow)
  if (firstData < 1) return null

  const header = rows[firstData - 1]
  const body = rows.slice(firstData).filter(isDataRow)
  if (!body.length) return null

  const categories = header.slice(1).map((cell, i) => cell || `#${i + 1}`)
  const labels = body.map((row, i) => row[0] || `series ${i + 1}`)
  // 表格默认画成雷达图；type 写错（比如 rader）也退回雷达，不要静默变成柱状图
  const wanted = String(directives.type || '').toLowerCase()
  const type = ['radar', 'bar', 'line', 'pie'].indexOf(wanted) >= 0 ? wanted : 'radar'
  const height = Number(directives.height) || 420

  // "colors: #E60000, #A9C9E8" 按系列顺序覆盖默认配色
  const custom = String(directives.colors || '').split(/[\s,]+/).filter(Boolean)
  const palette = custom.length ? custom : PALETTE
  const title = directives.title || directives.subtitle
    ? {
        ...(directives.title ? { text: directives.title } : {}),
        ...(directives.subtitle ? { subtext: directives.subtitle } : {})
      }
    : null

  if (type === 'radar') {
    // 行名是 max / min 的行给的是每根轴的量程，不画成系列
    const bounds = { max: {}, min: {} }
    const plots = []

    body.forEach((row) => {
      const key = String(row[0] || '').trim().toLowerCase()

      if (key !== 'max' && key !== 'min') {
        plots.push(row)
        return
      }

      valuesOf(row).forEach((value, column) => {
        if (value !== null) bounds[key][column] = value
      })
    })

    const names = plots.map((row, i) => row[0] || `series ${i + 1}`)

    // 没写 max 行时，每个轴各自取该列最大值，避免不同量纲的指标被同一个上限压扁
    const maxima = categories.map((_, column) => {
      if (bounds.max[column] != null) return bounds.max[column]
      return Math.max(1, ...plots.map(row => valuesOf(row)[column] || 0))
    })
    // min 行不小于上限时按 0 处理，否则整根轴会缩成一个点
    const minima = maxima.map((max, column) =>
      bounds.min[column] != null && bounds.min[column] < max ? bounds.min[column] : 0
    )

    return {
      ...(title ? { title } : {}),
      height,
      tooltip: { trigger: 'item', formatter: '<radar>' },
      legend: { bottom: 0, data: names },
      radar: {
        radius: directives.radius || '62%',
        ...(directives.center ? { center: String(directives.center).split(',').map((v) => v.trim()).filter(Boolean) } : {}),
        shape: String(directives.shape || '').toLowerCase() === 'circle' ? 'circle' : 'polygon',
        splitNumber: 5,
        indicator: categories.map((name, column) => ({ name, max: maxima[column], min: minima[column] }))
      },
      series: plots.map((row, i) => ({
        name: names[i],
        type: 'radar',
        symbol: 'none',
        lineStyle: { color: palette[i % palette.length], width: 2 },
        itemStyle: { color: palette[i % palette.length] },
        areaStyle: { color: palette[i % palette.length], opacity: 0.18 },
        data: [{ value: valuesOf(row), name: names[i] }]
      }))
    }
  }

  if (type === 'pie') {
    return {
      ...(title ? { title } : {}),
      height,
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [{
        type: 'pie',
        radius: ['0%', '62%'],
        data: body.map((row, i) => ({
          name: labels[i],
          value: valuesOf(row).find(value => value !== null) || 0
        }))
      }]
    }
  }

  // bar 和 line 共用一个形状
  return {
    ...(title ? { title } : {}),
    height,
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: labels },
    grid: { left: 48, right: 24, top: 24, bottom: 56 },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value' },
    series: labels.map((name, i) => ({
      name,
      type: type === 'line' ? 'line' : 'bar',
      barMaxWidth: 42,
      data: valuesOf(body[i])
    }))
  }
}

/** 表格围栏 -> option；不是表格时返回 null */
function tableFenceOption (text) {
  const { directives, rest } = readDirectives(String(text || '').split('\n'))
  return buildOption(directives, readRows(rest))
}

/** 这份表格实际会用到的配色，编辑器新增系列时按同一份取色 */
function tableFenceColors (text) {
  const { directives } = readDirectives(String(text || '').split('\n'))
  const custom = String(directives.colors || '').split(/[\s,]+/).filter(Boolean)
  return custom.length ? custom : PALETTE.slice()
}

// ---------------------------------------------------------------------------
// option -> 表格（编辑器回写用）
// ---------------------------------------------------------------------------

/** CJK 字符占两格，按显示宽度补空格才对得齐 */
function displayWidth (text) {
  return [...String(text)].reduce((sum, ch) => sum + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0)
}

function padTable (rows) {
  const widths = []

  rows.forEach(row => row.forEach((value, column) => {
    widths[column] = Math.max(widths[column] || 3, displayWidth(value))
  }))

  return rows.map(row => {
    const cells = row.map((value, column) => {
      const text = String(value == null ? '' : value)
      return ' ' + text + ' '.repeat(Math.max(0, widths[column] - displayWidth(text))) + ' '
    })

    return '|' + cells.join('|') + '|'
  })
}


/**
 * 已知指令按 option 重新生成（否则编辑器里改的标题、半径会被静默丢掉），
 * 不认识的指令行原样留在最后，注释之类不会被吃掉。
 */
function knownDirectives (option, prefix, series, baseline) {
  const known = /^(type|title|subtitle|height|colors|radius|center|shape)\s*:/i
  const unknown = prefix.filter(line => line.trim() && !known.test(line.trim()))

  const original = {}
  prefix.forEach(line => {
    const hit = DIRECTIVE.exec(line.trim())
    if (hit) original[hit[1].toLowerCase()] = hit[2].trim()
  })

  const radar = option.radar || {}
  const inferred = (radar.indicator || series.some(entry => entry && entry.type === 'radar'))
    ? 'radar'
    : series.length === 1 && series[0] && series[0].type === 'pie'
      ? 'pie'
      : series.length && series.every(entry => entry && entry.type === 'line') ? 'line' : 'bar'

  const out = [`type: ${original.type || inferred}`]

  if (option.title && option.title.text) out.push(`title: ${option.title.text}`)
  if (option.title && option.title.subtext) out.push(`subtitle: ${option.title.subtext}`)
  // 只有原本就写了 height 才回写，避免凭空多出一行
  if (original.height && option.height) out.push(`height: ${option.height}`)

  const baseRadar = (baseline && baseline.radar) || {}

  if (radar.radius && (original.radius || radar.radius !== baseRadar.radius)) {
    out.push(`radius: ${Array.isArray(radar.radius) ? radar.radius.join(', ') : radar.radius}`)
  }
  if (Array.isArray(radar.center) && radar.center.length &&
      (original.center || JSON.stringify(radar.center) !== JSON.stringify(baseRadar.center || null))) {
    out.push(`center: ${radar.center.join(', ')}`)
  }
  if (radar.shape && (original.shape || radar.shape !== baseRadar.shape)) out.push(`shape: ${radar.shape}`)
  if (original.colors) out.push(`colors: ${original.colors}`)

  return [...out, ...unknown]
}

/**
 * 把 option 写回表格围栏：指令行、说明行原样保留，只重建表头与数据行。
 * 这样编辑器里改数值，落到 md 里仍然是表格而不是 JSON。
 */
function optionToTableFence (option, originalBody) {
  const lines = String(originalBody || '').split('\n')
  const firstTable = lines.findIndex(line => /^\s*\|/.test(line))

  const prefix = firstTable > 0 ? lines.slice(0, firstTable) : []
  while (prefix.length && !prefix[prefix.length - 1].trim()) prefix.pop()

  const { rest } = readDirectives(lines)
  const rows = readRows(rest)

  const firstData = rows.findIndex(isDataRow)
  const captions = firstData > 1 ? rows.slice(0, firstData - 1) : []
  const headerRow = firstData > 0 ? rows[firstData - 1] : null
  const label = (headerRow && headerRow[0]) || '维度'

  const series = Array.isArray(option.series) ? option.series : []
  const indicators = option.radar && Array.isArray(option.radar.indicator) ? option.radar.indicator : null

  let header
  let body

  if (indicators && series.every(entry => entry && entry.type === 'radar')) {
    header = [label, ...indicators.map(item => (item && item.name) || '')]

    // 原本写了 max / min 量程行的，回写时照原样补回去，别把量程吃成数据行
    const hasRange = key => rows.some(row => String(row[0] || '').trim().toLowerCase() === key)
    const ranges = []
    if (hasRange('max')) ranges.push(['max', ...indicators.map(item => item.max)])
    if (hasRange('min')) ranges.push(['min', ...indicators.map(item => item.min)])

    body = [...ranges, ...series.map(entry => {
      const datum = (entry.data || [])[0] || {}
      const value = Array.isArray(datum.value) ? datum.value : []
      return [entry.name || '', ...value]
    })]
  } else if (series.length === 1 && series[0] && series[0].type === 'pie') {
    header = [label, (headerRow && headerRow[1]) || '数值']
    body = (series[0].data || []).map(item => [item.name, item.value])
  } else {
    const axis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis
    const categories = axis && Array.isArray(axis.data) ? axis.data : []

    header = [label, ...categories]
    body = series.map(entry => [entry.name || '', ...(Array.isArray(entry.data) ? entry.data : [])])
  }

  const divider = header.map((_, column) => (column === 0 ? '----' : '-----'))
  const table = padTable([...captions, header, divider, ...body])

  // 原本没写 radius/center 的围栏不要凭空多出指令行，除非这次真的改过
  const baseline = tableFenceOption(String(originalBody || '')) || {}

  return [...knownDirectives(option, prefix, series, baseline), ...table].join('\n')
}

module.exports = { isTableFence, tableFenceOption, tableFenceColors, optionToTableFence, tabFence }

/**
 * 一个围栏里放多张图，用 "## 标签" 分节，构建期生成左侧 tab + 多个面板。
 * 分节之前的行是全局指令，目前认 tabs（left/right）和 height。
 */
function splitTabSections(content) {
  const sections = []
  const preamble = []
  let current = null

  String(content).split('\n').forEach((line) => {
    const head = /^##\s+(.+?)\s*$/.exec(line.trim())

    if (head) {
      current = { label: head[1], body: [] }
      sections.push(current)
      return
    }

    if (current) current.body.push(line)
    else preamble.push(line)
  })

  return { preamble, sections }
}

/** 把一节的内容解析成 option：JSON 或表格，都不行就返回 null */
function sectionOption(body) {
  const text = String(body || '').trim()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch (err) {
    return isTableFence(text) ? tableFenceOption(text) : null
  }
}

/** 整段解析成 tab 组；不是 tab 围栏（没有 "## " 分节）时返回 null */
function tabFence(content) {
  const { preamble, sections } = splitTabSections(content)
  if (sections.length < 2) return null

  const options = []

  for (const section of sections) {
    const option = sectionOption(section.body.join('\n'))
    if (!option) return null // 有一节坏了就整段放弃，保留原文让人看见

    options.push({ label: section.label, option })
  }

  const directives = {}
  preamble.forEach((line) => {
    const hit = /^([a-zA-Z_]+)\s*:\s*(.+)$/.exec(line.trim())
    if (hit) directives[hit[1].toLowerCase()] = hit[2].trim()
  })

  return {
    side: directives.tabs === 'right' ? 'right' : 'left',
    height: Number(directives.height) || 0,
    options
  }
}
