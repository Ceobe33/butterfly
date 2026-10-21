# Changelog

本文件记录该主题（上游 jerryc127/hexo-theme-butterfly 的 fork）每个版本的显著变动。

格式基于 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/Ceobe33/butterfly/compare/v4.6.0...HEAD
[4.6.0]: https://github.com/Ceobe33/butterfly/compare/v4.5.0...v4.6.0
[4.5.0]: https://github.com/Ceobe33/butterfly/releases/tag/v4.5.0
