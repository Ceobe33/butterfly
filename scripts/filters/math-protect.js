/**
 * 保护 LaTeX 公式不被 Markdown 渲染器破坏。
 *
 * marked 会把公式里的 _ * \ 当成 Markdown 语法处理，例如
 *   $a_1 + b_2$  会被转成  $a<em>1 + b</em>2$
 * MathJax 拿到的源码就已经错了。这里在 before_post_render 把公式替换成占位符，
 * after_post_render 再原样换回来。
 *
 * 只对 front-matter 里写了 mathjax: true / katex: true 的文章生效，
 * 不影响其它文章（本站大量正文里有 $ 薪资数字）。
 */

'use strict'

const store = new Map()

// $$...$$ 、 \[...\] 、 \(...\) 、 $...$
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:[^\n$])+?)(?<!\s)\$/g

const token = i => `@@MATH${i}@@`

function protect (content) {
  const list = []
  const out = content.replace(MATH_RE, raw => {
    list.push(raw)
    return token(list.length - 1)
  })
  return { out, list }
}

function restore (content, list) {
  return content.replace(/@@MATH(\d+)@@/g, (raw, i) => {
    const item = list[Number(i)]
    return item === undefined ? raw : item
  })
}

hexo.extend.filter.register('before_post_render', data => {
  if (!data.mathjax && !data.katex) return data
  if (typeof data.content !== 'string' || !data.content) return data

  const { out, list } = protect(data.content)
  if (!list.length) return data

  store.set(data.source, list)
  data.content = out
  return data
}, 1)

hexo.extend.filter.register('after_post_render', data => {
  const list = store.get(data.source)
  if (!list) return data

  if (typeof data.content === 'string') data.content = restore(data.content, list)
  if (typeof data.excerpt === 'string') data.excerpt = restore(data.excerpt, list)
  if (typeof data.more === 'string') data.more = restore(data.more, list)

  store.delete(data.source)
  return data
}, 5)
