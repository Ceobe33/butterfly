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
 * 围栏体也可以直接写 Markdown 表格（数据只有一份），表格前面的 `key: value` 是指令：
 *
 *   ```echarts
 *   type: radar
 *   height: 460
 *   | 维度 | 对手R | 敌人E | 伙伴P |
 *   | --- | --- | --- | --- |
 *   | 极限 | 5 | 5 | 5 |
 *   | 强度 | 1 | 2 | 4 |
 *   ```
 *
 * 支持 type: radar / bar / line / pie（默认 bar），转换规则见 scripts/filters/echarts-table.js。
 *
 * 说明：
 * - 必须在 before_post_render 阶段插入裸 HTML（tag.render 在 markdown 之后才跑）；
 *   JSON 压缩成一行，marked 遇到空行才结束 HTML 块，所以整段会被当作一个完整 HTML 块透传。
 * - 图表用的 ECharts 由页面按需从 CDN 加载，不用的文章不会多加载任何 JS。
 * - height 是约定字段，默认 420，传给 ECharts 前会被剔除。
 * - tooltip.formatter 可以写成字符串占位 "<radar>"：JSON 写不了函数，而雷达图默认只显示
 *   被点中的那个系列（上层多边形盖住下层）。这个占位会在运行期换成函数，一次列出同一圈
 *   上所有系列的数值。
 */

'use strict'

const { isTableFence, tableFenceOption, tabFence } = require('./echarts-table')

const CDN = hexo.config.echarts_cdn ||
  'https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js'

const fenceReg = /(\s*)(`{3,}) *(echarts) *\n?([\s\S]+?)\s*(\2)(\n+|$)/g
const skipExt = ['.js', '.css', '.html', '.htm']

const escapeAttr = str => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const escapeText = str => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

function tabsHtml(start, tabs) {
  const buttons = tabs.options
    .map((entry, i) => `<button type="button"${i === 0 ? ' class="is-active"' : ''} data-tab="${i}">${escapeText(entry.label)}</button>`)
    .join('')

  const panels = tabs.options
    .map((entry) => {
      const option = JSON.parse(JSON.stringify(entry.option))
      const height = tabs.height || Number(option.height) || 420
      delete option.height

      return `<div class="echarts-wrap" data-options="${escapeAttr(JSON.stringify(option))}" style="height:${height}px"></div>`
    })
    .join('')

  return `${start}<div class="echarts-tabs" data-side="${tabs.side}" data-active="0"><div class="echarts-tabs-nav">${buttons}</div><div class="echarts-tabs-panels">${panels}</div></div>\n\n`
}

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

  // 雷达图默认 tooltip 只显示被点中的那个系列——上层多边形把下层盖住，因此永远只看得到
  // "极限"这一层，看不到分数。JSON 里写不了函数，所以约定字符串占位 "formatter": "<radar>"，
  // 在这里换成真正的函数，一次列出同一圈上所有系列的数值。
  var radarTooltip = function (option) {
    var labels = ((option.radar && option.radar.indicator) || []).map(function (item) {
      return (item && item.name) || ''
    })
    var series = (option.series || []).filter(function (s) { return s && s.type === 'radar' })

    var names = series.map(function (s) { return s.name })

    return function (params) {
      var index = params.dataIndex == null ? 0 : params.dataIndex
      var head = (params.data && params.data.name) || params.seriesName || ''

      var rows = labels.map(function (label, i) {
        var cells = series.map(function (s) {
          var datum = (s.data || [])[index] || {}
          var value = Array.isArray(datum.value) ? datum.value[i] : datum.value
          return (s.name ? s.name + ' ' : '') + (value == null ? '-' : value)
        })
        return label + '：' + cells.join(' ｜ ')
      })

      // the item name is usually just the series name again, so only show it when it adds something
      return (names.indexOf(head) < 0 ? [head] : []).concat(rows).join('<br/>')
    }
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

    if (option2.tooltip && option2.tooltip.formatter === '<radar>') {
      option2.tooltip.formatter = radarTooltip(option2)
    }

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

  // 挂一张图（同一个容器只挂一次）
  var mount = function (echarts, el) {
    if (!el) return null
    if (el.__echarts) return el.__echarts

    var option
    try {
      option = JSON.parse(el.dataset.options)
    } catch (e) {
      console.error('[echarts] option 解析失败', e)
      return null
    }

    var chart = echarts.init(el)
    chart.setOption(tune(option, isDark()))
    el.__echarts = chart
    charts.push(chart)
    return chart
  }

  // 左侧 tab 切换的多图：隐藏的面板不初始化，避免拿到 0 宽高
  var wireTabs = function (echarts, group) {
    var nav = group.querySelector('.echarts-tabs-nav')
    var buttons = nav ? [].slice.call(nav.querySelectorAll('button')) : []
    var panels = [].slice.call(group.querySelectorAll('.echarts-tabs-panels > .echarts-wrap'))
    if (!buttons.length || !panels.length) return

    var show = function (index) {
      buttons.forEach(function (button, i) { button.classList.toggle('is-active', i === index) })
      panels.forEach(function (panel, i) { panel.style.display = i === index ? 'block' : 'none' })

      group.dataset.active = String(index)

      var chart = mount(echarts, panels[index])
      if (chart) chart.resize()
    }

    if (!group.__wired) {
      group.__wired = true
      buttons.forEach(function (button, i) {
        button.addEventListener('click', function () { show(i) })
      })
    }

    var active = Math.min(Number(group.dataset.active) || 0, panels.length - 1)
    show(active)
  }

  var render = function (echarts) {
    charts.forEach(function (c) { c.dispose() })
    charts = []

    var wraps = targets()
    wraps.forEach(function (el) { delete el.__echarts })

    var groups = [].slice.call(document.querySelectorAll('#article-container .echarts-tabs'))
    groups.forEach(function (group) { wireTabs(echarts, group) })

    wraps.forEach(function (el) {
      if (el.closest('.echarts-tabs')) return // 由 wireTabs 按需挂载
      mount(echarts, el)
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
      // 多个 "## 小节" = 一组 tab 图，交给专门的渲染
      const tabs = tabFence(content)
      if (tabs) {
        hit = true
        return tabsHtml(start, tabs)
      }

      let option

      try {
        option = JSON.parse(content.trim())
      } catch (err) {
        // 不是 JSON 的时候还可以是 Markdown 表格，表格即数据，图表在构建期生成
        option = isTableFence(content) ? tableFenceOption(content) : null

        if (!option) {
          hexo.log.warn(`[echarts] ${source} 中的 echarts 围栏既不是合法 JSON 也不是可用的表格，已原样保留：${err.message}`)
          return raw
        }
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
