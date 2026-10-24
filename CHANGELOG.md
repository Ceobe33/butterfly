# Changelog

本文件记录该主题（上游 jerryc127/hexo-theme-butterfly 的 fork）每个版本的显著变动。

格式基于 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

尚未发布的改动放在最上面，**按日期分组**：每个日期下再分 Added / Changed / Fixed，新的一天加在最上面。
已发布的版本仍以版本号为节，节标题里带发布日期。日期取改动落地那天，不是写记录的日期。

## 2026-10-24

### Added

- 可视化编辑器支持 **tree**（组织架构图）围栏。树图没有数值可拖，所以右侧面板换成了层级列表：
  每行按深度缩进，改名、加子节点、删节点（连子树一起删）；「父级」下拉把整棵子树换挂到别的
  节点下（自己的子孙不会出现在选项里，避免成环），↑ / ↓ 调整同级次序——同级顺序决定它在画布
  上的上下位置。画布上点节点会高亮对应行
- 树图的**比例与布局**在面板顶部直接改：画布高（写回 option 的 `height`，博客端按它撑开容器）、
  字号、行高、内边距上下/左右、连线宽度、节点大小、层级（`initialTreeDepth`，默认展开到第几层）
  以及 `top/left/bottom/right` 布局框。树图太大看不全时，先加画布高，再缩字号和内边距
- 树图的编辑也进了撤销栈：快照里带上整个 series，撤销能还原被删掉的节点

### Changed

- 无 scatter 节点的图表（radar / pie / tree）在画布上不再响应框选拖拽，避免拖出选框却选不中东西

## 2026-10-23

### Added

- 标签页改为 **3D 标签球**（`source/js/tag-sphere.js` + `css/_page/tag-sphere.styl`）：
  标签按 Fibonacci 球面均匀分布，可拖拽旋转（带惯性）并缓慢自转；悬停显示该标签的文章数，
  点击进入标签页；字号随文章数缩放，颜色按色相铺开，深浅主题自动换色。
  canvas 之外另输出一份 sr-only 链接列表，读屏与爬虫仍能拿到真实链接与计数。
  行为在 `tag_sphere` 下配置：`enable`（关掉后退回主题原有的标签云）、
  `depth`（`front` / `back`，决定哪一面清晰）、`min_opacity`（淡出那侧的不透明度下限）
- 编辑器右侧列表支持**拖拽排序**（每行左侧 ⠿ 手柄），顺序即数据顺序：影响 sankey 同层节点的
  堆叠次序、折线图的连线走向。桑基图首次拖动会自动把 `layoutIterations` 置 0，否则 ECharts
  会重新排序以减少连线交叉，拖动结果在画面上看不出来；面板表头的「Keep order」可关闭该锁定
- 可视化编辑器支持 **sankey** 图：节点可改名、改色、增删，连线可用下拉选择起止节点并改流量值；
  改名会自动同步相关连线，删节点会一并删掉挂在它上面的连线，避免产生孤立引用

### Fixed

- 编辑器打不开用 **JS 对象字面量**写的 ```echarts 围栏（键没引号、单引号、`//` 注释），
  报 `Expected property name or '}'`：解析改为先 `JSON.parse`，失败再按表达式求值。
  顺带提示这类围栏在博客端 `echarts-fence.js` 里同样会被跳过（它只认严格 JSON），
  状态栏显示 “Not strict JSON”；保存会重写成标准 JSON，既修好文章也丢掉围栏内的注释。
  含 `function` 的围栏（如 `formatter: function (p) {...}`）拒绝回写并给出路径，
  避免 `JSON.stringify` 静默丢弃函数
- 标签球的景深方向反了：透视用的是 `fov / (fov + z * radius)`，`z` 越小离观察者越近，
  但透明度按 `0.3 + 0.7 * ((z + 1) / 2)` 算，结果是**背面不透明、正面只有 0.3**。
  改为按 `near = (1 - z) / 2` 取值，正面清晰、背面淡出；新增 `tag_sphere.depth`
  （`front` / `back`）可整页翻转，改 `#tag-sphere` 的 `data-depth` 也能实时预览；
  淡出那侧的下限由 `tag_sphere.min_opacity`（默认 0.3）控制
- 编辑器取消勾选「Auto-sync」后仍会写文件：防抖定时器在取消勾选前已经排好，到点照常执行。
  现在取消勾选会清掉排队中的写入，定时器触发时也会再确认一次开关状态；
  切换文件/围栏时同样丢弃排队写入，避免旧数据被写进新打开的文件
- `random_cover` 遇到非字符串的 `cover`（例如 front-matter 手误写成 `cover: 33`）不再让整个
  构建 FATAL，改为打印警告并跳过该字段
- 编辑器右侧面板无法滚动：`.nodes` 是 flex 列容器，子项默认被压缩到容器高度而不是溢出，
  导致 `scrollHeight` 恒等于 `clientHeight`；补 `flex: 0 0 auto` 后行高不再被压扁

## 2026-10-21

### Added

- `tools/echart-editor` 升级为工作区模式：不带 `--file` 启动即为**空白画布**，无需预设目标文件
- 浏览器内「打开…」弹窗：搜索并打开 `source/**/*.md` 与根目录下的图表文件，
  支持直接编辑已有 ```echarts 围栏
- 「插入当前图表」：把画布内容作为新的 ```echarts 围栏插入到 markdown 的文首、
  指定标题之后或文末；插入后自动切换到该围栏继续编辑
- 打开还没有图表的文章时给出空白画布，而不是报错
- 文件弹窗的「只看含图表」过滤：直接筛出带 ```echarts 围栏的文章并显示围栏数量
  （用 grep 单进程扫描并在启动时预热，1000+ 篇文章约 0.3 秒）
- 关闭浏览器页面后服务自动退出：页面用 `sendBeacon` 通知，3 秒宽限（刷新不误杀），
  浏览器崩溃等异常情况以 120 秒无心跳兜底；新增 `--keep-alive` 保持常驻
- 编辑器整体文案改为英式英语（界面、终端输出、README）

### Changed

- `npm run echart` 默认进入空白画布（原为编辑根目录 `echart.js`）；`ec` 为同义短命令

### Fixed

- 打开没有 `scatter` 序列的图表（如雷达图）不再报「无法定位节点」，改为自动进入**数据模式**：
  右侧列出 `series` 里的数值（雷达图按指标顺序，悬停显示指标名），修改后自动回写；
  新增 `POST /api/option` 用于按整份 option 回写

## [4.6.0] - 2026-10-21

### Added

- ```echarts 围栏渲染：`scripts/filters/echarts-fence.js` 把文章里的 ```echarts 代码块转成
  ECharts 图表，`height` 作为容器高度（默认 420），脚本按需从 CDN 加载（`echarts@6`），
  并跟随浅色/深色主题重新着色
- 配套的可视化编辑器 `tools/echart-editor/`，用法见该目录的 `README.md`：
  - `npm run echart` 启动本地服务并自动打开浏览器，可编辑 `echart.js`、纯 JSON option，
    或 markdown 里指定的 ```echarts 围栏（围栏外内容一字不动）
  - 画布上拖动节点，右侧改坐标 / 颜色 / 标签方位，改动防抖后自动回写源文件
  - 框选多选、水平与垂直对齐/分布、批量改色改方位、方向键微调、撤销重做（⌘Z）
  - 「按博客渲染」模式复刻 `echarts-fence.js` 的 `tune()` 与容器尺寸，与线上所见一致
- `daily_recommend.enable` 总开关（默认 `true`）。关闭后不再抽取推荐、不写 `source/_data/daily-recommend.json`，
  且 `layout: daily` 的页面会从 `locals.pages` 中移除、不再生成

### Changed

- `package.json` 版本同步为 4.6.0

## [4.5.0] - 2026-09-29

### Added

- 站点自定义脚本迁入主题，开箱即用：
  - `scripts/filters/auto_cover.js` — 无封面文章自动生成 SVG 封面
  - `scripts/filters/daily_recommend.js` — 每日推荐抽取与 `daily_recommend()` helper
  - `scripts/filters/hash_chinese_path.js` — 中文路径段哈希化，避免 URL 编码过长
  - `scripts/filters/raw_html_post.js` — `_posts` 下的 `.html` 原样渲染、禁用布局
  - `scripts/tag/tolerant_post_link.js` — `post_link` 找不到文章时回落占位链接而非构建中断
- `daily_recommend` 配置项（`max_count` / `default_count`），读取主题配置 `hexo.theme.config`；
  主题 `_config.yml` 提供默认值，站点侧用根 `_config.butterfly.yml` 覆盖
- 文章表格不再被容器宽度限制：`source/css/_global/table.styl` 让表格按内容宽度排布、单元格不换行、
  超出部分由表格自身横向滚动；`source/js/tableShadow.js` 在还有内容的一侧显示阴影

### Fixed

- 浏览器后退/前进不再跳回页面顶部：pjax 开启 `scrollRestoration`，
  并在 `pjax:complete` 后按记录的坐标二次校正（图片撑开文档高度会让首次落点偏上）

### Changed

- `package.json` 版本同步为 4.5.0

[4.6.0]: https://github.com/Ceobe33/butterfly/compare/v4.5.0...v4.6.0
[4.5.0]: https://github.com/Ceobe33/butterfly/releases/tag/v4.5.0
