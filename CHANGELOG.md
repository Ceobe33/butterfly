# Changelog

本文件记录该主题（上游 jerryc127/hexo-theme-butterfly 的 fork）每个版本的显著变动。

格式基于 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

尚未发布的改动放在最上面，**按日期分组**：每个日期下再分 Added / Changed / Fixed，新的一天加在最上面。
已发布的版本仍以版本号为节，节标题里带发布日期。日期取改动落地那天，不是写记录的日期。

## 2026-10-28

### Added

- 新增 `tools/serve.js` 作为 `npm run server`：**按需重建**的开发服务器 —— 文件变动只打一个
  「脏」标记（hexo box 的 chokidar 监听，单文件几十毫秒），刷新页面时才跑 `_generate()`。
  实测：改动后刷新 1.5 秒出新页面，没改动时连刷不重建。之所以这么做：hexo 的
  `source.process()` 是全量扫描，这个站 1400+ 篇要 37 秒，而 `_generate({cache:true})` 只要 1.5 秒。
  原命令保留为 `npm run server:hexo`
- 移除 `hexo-browsersync`：它盯 `route.on('update')` 自动刷浏览器，正是"改点东西页面就跳"的来源
- **跨文章引用**（`scripts/filters/include_block.js`）：源文章里用
  `<!-- #region 名字 -->` … `<!-- #endregion 名字 -->` 圈一段（也认 `begin` / `end`），
  别的文章写 `{% include_block 路径#名字 %}` 或短别名 `{% inc 路径 名字 %}` 就能整段引进来
  （路径相对 `source/_posts`，扩展名可省），
  不用重复写。做成 priority 5 的 `before_post_render` filter 而不是 tag，是因为 tag 在 markdown
  渲染之后才展开——那样被引用内容里的 ```echarts 围栏就赶不上围栏过滤器；现在引入的是原始
  markdown，标题、表格、图表都照常处理。锚点注释不会输出到页面；找不到文件或锚点时打 WARN
  并在正文留一条提示。支持 A→B→C 链式引用（最多 3 层）
- ```echarts 围栏支持 **tab 分组**：一个围栏里用 `## 标签` 分节，每节一张图（JSON 或表格都行），
  节前的 `tabs: left|right` 决定 tab 位置、`height` 统一下高度。构建期生成左侧 tab + 多面板，
  切换时才初始化对应图表（隐藏面板初始化会拿到 0 尺寸）；深浅主题切换保留当前 tab。
  样式在新文件 `source/css/_page/echarts.styl`，分节解析放进 `echarts-table.js` 与编辑器共用，
  编辑器遇到 tab 围栏只预览第一节、拒绝回写
- ```echarts 围栏可以直接写 **Markdown 表格**，构建期把表格转成 option，数据只维护一份：
  表格前的 `type: radar|bar|line|pie`（默认 bar）、`height`、`colors` 是指令；表头取
  "第一行全数字之前最后一个非全数字行"，所以 `| 伙伴型同事 | （P型） |` +
  `| 维度 | 对手R | 敌人E | 伙伴P |` 这种两行表头也认；每行一个系列，行名即系列名。
  解析器独立成 `scripts/filters/echarts-table.js`，编辑器复用同一份做预览（只读，
  拒绝回写以保住表格），两边不会跑偏

- 编辑器围栏下拉框可直接新建图表：`＋ New · 形状 · 出处` 取自项目里已有的每种图表形状
  （当前是 funnel / line+scatter / pie / radar / sankey / tree），选中即在该围栏下方插入一份
  可直接改的副本并切换过去；另加 `⧉ Duplicate this chart` 复制当前图表
- 数据模式面板新增 **title / subtext 编辑**，雷达图、饼图这类没有散点节点的图表终于能改标题
- 每个 series 表头新增 **▲ / ▼** 调整 `series` 数组顺序：后画的在上层，也就决定了 hover 时
  命中哪个系列（雷达图里小的多边形被大的整片盖住时，只能靠它把小的挪到最上层）；
  面板里的行拖拽只改同一系列的数据点顺序，改不了系列顺序，这点现在有明确入口了。
  撤销/重做的快照同步扩展到数据模式的整段 `series`

### Fixed

- 表格围栏在编辑器里改完无法保存（上一版把它设成了只读，打开文章默认停在第一张表格图上，
  看起来像"整个编辑器的回写坏了"）：新增 `optionToTableFence()` 把 option 反向写成表格，
  改动只重建表头与数据行，`type` / `title` / `colors` 等指令行和说明行原样保留，
  真正改过的 `radius` / `center` 才补写。往返幂等，不会把表格换成 JSON
- 「Auto-sync」复选框和实际行为不一致：`index.html` 里的 input 没有 `checked`，页面加载时
  显示**未勾选**，而 `state.autoSync` 默认 `true` —— 于是"明明没勾选"也照样写文件。
  现在页面里默认带 `checked`，并且在 `bindStatic` 里把勾选态强制对齐到 `state.autoSync`
- 表格围栏的**副标题**存不住：回写只生成 `title:`，`option.title.subtext` 被丢掉。
  新增 `subtitle` 指令（读、写都支持），JSON 围栏本来就没问题
- 雷达图 tooltip 只显示被点中的那个系列（上层多边形盖住下层，永远只看得到「极限」）：
  JSON 围栏写不了函数，改为约定字符串占位 `"formatter": "<radar>"`，
  由 `echarts-fence.js` 的 BOOT 换成函数，一次列出同一圈上所有系列的数值；
  编辑器的「按博客渲染」同步了这段逻辑
- 《在职场中，该如何处理与同事之间的关系》里的雷达围栏多了一个逗号，`JSON.parse` 失败，
  博客端一直按原样保留、没有渲染；补齐逗号并改用上面的 tooltip 占位

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
