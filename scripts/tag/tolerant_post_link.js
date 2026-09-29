// Hexo 5 的 post_link 在找不到文章时只会输出一个占位链接（构建继续）；
// Hexo >= 7 改成直接 throw，导致整站构建 FATAL 中断。
// 这里覆盖内置 post_link：先用多种规则解析文章，实在找不到才退回占位链接并打印警告。
//
// 说明：本站有 1000+ 处 post_link，其中部分引用的是历史分类目录名（如 22汽车行业专题 -> 04如何选行业），
// 或标题里带了 slug 中不存在的标点。下面会自动做「忽略目录前缀 / 忽略标点」的兜底匹配。

const { encodeURL, escapeHTML } = require('hexo-util')

// 匹配时忽略的字符：空白、常见中英文标点、路径分隔符
const STRIP = /[\s\u3000\u200b,./\\|`~!@#$%^&*()_+\-=[\]{};:'"<>?，。！？；：、“”‘’（）《》【】…—·]/g

const normalize = str => String(str || '').replace(STRIP, '').toLowerCase()

let cache = null

function buildIndex (ctx) {
  const posts = ctx.model('Post').toArray()
  const byFull = new Map()
  const byName = new Map()

  for (const post of posts) {
    const source = String(post.source || '')
      .replace(/^_posts\//, '')
      .replace(/\.md$/i, '')

    if (source) {
      byFull.set(normalize(source), post)
      const name = normalize(source.split('/').pop())
      if (name) {
        // 同名文章有多篇时记为歧义，避免自动指向错误的目标
        if (byName.has(name) && byName.get(name) !== post) byName.set(name, null)
        else byName.set(name, post)
      }
    }
    if (post.slug) byFull.set(normalize(post.slug), post)
    if (post.title) byFull.set(normalize(post.title), post)
  }

  return { count: posts.length, byFull, byName }
}

function getIndex (ctx) {
  const count = ctx.model('Post').toArray().length
  if (!cache || cache.count !== count) cache = buildIndex(ctx)
  return cache
}

function resolvePost (ctx, slug) {
  const Post = ctx.model('Post')

  // 1. 内置行为：按 slug / title 精确查找
  const post = Post.findOne({ slug }) || Post.findOne({ title: slug })
  if (post) return post

  const index = getIndex(ctx)

  // 2. 忽略标点差异后全量匹配（处理 "到底如何买房？" vs "到底如何买房"）
  const full = index.byFull.get(normalize(slug))
  if (full) return full

  // 3. 忽略失效的分类目录前缀，只按文件名匹配（处理 "22汽车行业专题/xxx" -> "04如何选行业/xxx"）
  const name = normalize(String(slug).split('/').pop())
  return index.byName.get(name) || null
}

hexo.extend.tag.register('post_link', function (args) {
  const ctx = hexo
  const original = args.join(' ')

  let slug = args.shift()
  if (!slug) return `<a href="#">Post not found: ${escapeHTML(original)}</a>`

  let hash = ''
  const parts = slug.split('#')
  if (parts.length === 2) {
    slug = parts[0]
    hash = parts[1]
  }

  let escape = args[args.length - 1]
  if (escape === 'true' || escape === 'false') {
    args.pop()
  } else {
    escape = 'true'
  }

  const post = resolvePost(ctx, slug)

  if (!post) {
    hexo.log.warn(`[post_link] 找不到文章，已输出占位链接：${slug}`)
    return `<a href="#">Post not found: ${escapeHTML(original)}</a>`
  }

  let title = args.length ? args.join(' ') : (post.title || post.slug)
  const attrTitle = escapeHTML(post.title || post.slug)
  if (escape === 'true') title = escapeHTML(title)

  const url = new URL(post.path, ctx.config.url).pathname + (hash ? `#${hash}` : '')

  return `<a href="${encodeURL(url)}" title="${attrTitle}">${title}</a>`
})
