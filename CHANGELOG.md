# Changelog

本文件记录该主题（上游 jerryc127/hexo-theme-butterfly 的 fork）每个版本的显著变动。

格式基于 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

### Fixed

- 浏览器后退/前进不再跳回页面顶部：pjax 开启 `scrollRestoration`，
  并在 `pjax:complete` 后按记录的坐标二次校正（图片撑开文档高度会让首次落点偏上）

### Changed

- `package.json` 版本同步为 4.5.0

[Unreleased]: https://github.com/Ceobe33/butterfly/compare/v4.5.0...HEAD
[4.5.0]: https://github.com/Ceobe33/butterfly/releases/tag/v4.5.0
