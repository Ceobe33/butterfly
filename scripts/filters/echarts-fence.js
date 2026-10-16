/**
 * 让 ```echarts 围栏代码块渲染成 ECharts 图表。
 *
 * 用法（围栏里写标准 ECharts option，JSON 格式）：
 *
 *   ```echarts
 *   {
 *     "height": 460,
 *     "radar": { "indicator": [ ... ] },
 *     "series": [ { "type": "radar", "data": [ ... ] } ]
 *   }
 *   ```
 *
 * 说明：
 * - 必须在 before_post_render 阶段插入裸 HTML（tag.render 在 markdown 之后才跑）；
 *   JSON 压缩成一行，marked 遇到空行才结束 HTML 块，所以整段会被当作一个完整 HTML 块透传。
 * - 图表用的 ECharts 由页面按需从 CDN 加载，不用的文章不会多加载任何 JS。
 * - height 是约定字段，默认 420，传给 ECharts 前会被剔除。
 */

'use strict'

const CDN = hexo.config.echarts_cdn ||
  'https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js'

const fenceReg = /(\s*)(`{3,}) *(echarts) *\n?([\s\S]+?)\s*(\2)(\n+|$)/g
const skipExt = ['.js', '.css', '.html', '.htm']

const escapeAttr = str => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const BOOT = `(function () {
  if (window.__echartsBooted) return
  window.__echartsBooted = true

  var CDN = '__ECHARTS_CDN__'
  var charts = []

  var targets = function () {
    return Array.prototype.slice.call(
      document.querySelectorAll('#article-container .echarts-wrap')
    )
  }

  var isDark = function () {
    return document.documentElement.getAttribute('data-theme') === 'dark'
  }

  var load = function () {
    return new Promise(function (resolve, reject) {
      if (window.echarts) return resolve(window.echarts)
      var s = document.createElement('script')
      s.src = CDN
      s.onload = function () { resolve(window.echarts) }
      s.onerror = function () { reject(new Error('ECharts 加载失败: ' + CDN)) }
      document.head.appendChild(s)
    })
  }

  // 按浅色/深色调整文字与网格颜色，背景保持透明以贴合主题
  var tune = function (option, dark) {
    var option2 = JSON.parse(JSON.stringify(option))
    var text = dark ? '#c9d1d9' : '#4c4948'
    var line = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)'
    var area = dark
      ? ['rgba(255,255,255,0.03)', 'rgba(255,255,255,0.06)']
      : ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.04)']

    option2.backgroundColor = 'transparent'
    option2.textStyle = Object.assign({ color: text }, option2.textStyle)

    if (option2.legend) {
      option2.legend.textStyle = Object.assign({ color: text }, option2.legend.textStyle)
    }
    if (option2.radar) {
      option2.radar.axisName = Object.assign({ color: text }, option2.radar.axisName)
      option2.radar.axisLine = Object.assign({ lineStyle: { color: line } }, option2.radar.axisLine)
      option2.radar.splitLine = Object.assign({ lineStyle: { color: line } }, option2.radar.splitLine)
      option2.radar.splitArea = Object.assign({ areaStyle: { color: area } }, option2.radar.splitArea)
    }
    ['xAxis', 'yAxis'].forEach(function (key) {
      if (!option2[key]) return
      var list = Array.isArray(option2[key]) ? option2[key] : [option2[key]]
      list.forEach(function (axis) {
        axis.axisLabel = Object.assign({ color: text }, axis.axisLabel)
        axis.axisLine = Object.assign({ lineStyle: { color: line } }, axis.axisLine)
      })
    })

    return option2
  }

  var render = function (echarts) {
    charts.forEach(function (c) { c.dispose() })
    charts = []

    targets().forEach(function (el) {
      var option
      try {
        option = JSON.parse(el.dataset.options)
      } catch (e) {
        console.error('[echarts] option 解析失败', e)
        return
      }
      var chart = echarts.init(el)
      chart.setOption(tune(option, isDark()))
      charts.push(chart)
    })
  }

  var boot = function () {
    load().then(render).catch(function (err) { console.error('[echarts]', err) })
  }

  document.addEventListener('DOMContentLoaded', boot)
  document.addEventListener('pjax:complete', boot)

  // 切换浅色/深色主题时重绘
  new MutationObserver(function () {
    if (window.echarts) render(window.echarts)
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  window.addEventListener('resize', function () {
    charts.forEach(function (c) { c.resize() })
  })

  if (document.readyState !== 'loading') boot()
})()`.replace('__ECHARTS_CDN__', CDN)

// priority 8，与 mermaid-fence 同层，优先于其它围栏插件
hexo.extend.filter.register('before_post_render', data => {
  const source = data.source || ''
  const ext = source.substring(source.lastIndexOf('.')).toLowerCase()
  if (skipExt.includes(ext)) return

  let hit = false

  data.content = data.content.replace(fenceReg,
    (raw, start, quote, lang, content) => {
      let option
      try {
        option = JSON.parse(content.trim())
      } catch (err) {
        hexo.log.warn(`[echarts] ${source} 中的 echarts 围栏不是合法 JSON，已原样保留：${err.message}`)
        return raw
      }

      hit = true
      const height = Number(option.height) || 420
      delete option.height

      return `${start}<div class="echarts-wrap" data-options="${escapeAttr(JSON.stringify(option))}" style="height:${height}px"></div>\n\n`
    })

  if (hit && !data.content.includes('__echartsBooted')) {
    data.content += `\n\n<script class="echarts-boot">${BOOT}</script>\n\n`
  }
}, 8)
