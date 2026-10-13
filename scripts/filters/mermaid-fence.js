/**
 * 让 ```mermaid 围栏代码块走 Butterfly 自带的 mermaid 渲染
 * 输出与 themes/butterfly/scripts/tag/mermaid.js 一致的结构：
 *   <div class="mermaid-wrap"><pre class="mermaid-src" hidden>...</pre></div>
 *
 * 注意：这里必须在 before_post_render 阶段插入裸 HTML（tag.render 在 markdown 之后才跑），
 * 而 marked 遇到空行就结束 HTML 块，所以要把内容里的空行去掉 —— mermaid 语法不吃空行，
 * 去掉不影响渲染，但能保证整段被当作一个完整的 HTML 块透传。
 */

'use strict'

const { escapeHTML } = require('hexo-util')

const fenceReg = /(\s*)(`{3,}) *(mermaid) *\n?([\s\S]+?)\s*(\2)(\n+|$)/g
const skipExt = ['.js', '.css', '.html', '.htm']

// priority 8 < hexo-filter-mermaid-diagrams 的 9，保证围栏先被这里吃掉
hexo.extend.filter.register('before_post_render', data => {
  const source = data.source || ''
  const ext = source.substring(source.lastIndexOf('.')).toLowerCase()
  if (skipExt.includes(ext)) return

  data.content = data.content.replace(fenceReg,
    (raw, start, quote, lang, content) => {
      const src = content.split(/\r?\n/).filter(line => line.trim() !== '').join('\n')
      // 结尾必须留一个空行，否则 marked 会认为 HTML 块还没结束，
      // 把紧跟着的标题/段落一起当成裸 HTML 吞掉
      return `${start}<div class="mermaid-wrap"><pre class="mermaid-src" hidden>\n${escapeHTML(src)}\n</pre></div>\n\n`
    })
}, 8)
