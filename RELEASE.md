# 版本与发版规范

本仓库是 [jerryc127/hexo-theme-butterfly](https://github.com/jerryc127/hexo-theme-butterfly) 的 fork，
版本规则沿用两个公开标准：

- 版本号：[Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)（`MAJOR.MINOR.PATCH`）
- 变更记录：[Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)（`CHANGELOG.md`）
- 提交信息：[Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)

## 1. 版本号

版本号格式 `X.Y.Z`，均为非负整数且不补零；递增时低位归零。

| 段位 | 何时递增 | 本主题的判定范围（"公共 API"） |
| --- | --- | --- |
| `MAJOR` | 不兼容的变更 | 删除/重命名 `_config.yml` 配置项、删除或改名 layout 模板、删除 tag 插件或 helper、改变既有配置项语义 |
| `MINOR` | 向下兼容的新增 | 新增配置项、新增脚本/helper/tag、新增可覆盖的 layout 片段、新增配置默认值 |
| `PATCH` | 向下兼容的修复 | 修 bug、样式/脚本的行为修正、在不改变配置语义的前提下调整默认值 |

补充说明：

- 仅改动注释、文档、格式化 → 不单独发版，随下一次发布一起记录。
- 不兼容的变更必须先在一个 `MINOR` 版本里标记 `Deprecated`（CHANGELOG 写明迁移方式），
  再在下一个 `MAJOR` 版本里 `Removed`。
- `package.json` 的 `version` 必须与发版号一致。

## 2. 变更类型（CHANGELOG 段落）

按顺序书写，空段落直接省略：

- `Added` 新功能
- `Changed` 现有功能的变更
- `Deprecated` 即将移除的功能
- `Removed` 已移除的功能
- `Fixed` bug 修复
- `Security` 安全修复

要求：写给人看，不抄 git log；每个版本一段、倒序排列、带 ISO 日期（`YYYY-MM-DD`）与比较链接。

## 3. 提交信息

```
<type>(<scope>): <subject>
```

- `type`：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`
- `scope`：可选，如 `pjax`、`scripts`、`config`、`css`
- `feat` 对应 `MINOR`，`fix` 对应 `PATCH`；`BREAKING CHANGE:` 脚注对应 `MAJOR`

例：

```
fix(pjax): 浏览器后退时恢复滚动位置
feat(scripts): 每日推荐篇数改为主题配置项
```

## 4. 发版流程

1. 开发期间把改动写进 `CHANGELOG.md` 的 `## [Unreleased]`。
2. 发版前自检（见第 5 节）。
3. 定版本号：按第 1 节的规则确定 `X.Y.Z`。
4. 改文件：
   - `CHANGELOG.md`：把 `Unreleased` 的内容搬到 `## [X.Y.Z] - YYYY-MM-DD`，补上比较链接
   - `package.json`：`version` 改为 `X.Y.Z`
5. 提交：`git commit -am "chore(release): vX.Y.Z"`
6. 打标签：`git tag -a vX.Y.Z -m "vX.Y.Z"`
7. 推送：`git push origin master && git push origin vX.Y.Z`
8. GitHub Release：以 `CHANGELOG.md` 中该版本的条目作为发布说明（标题 `vX.Y.Z`）。
9. 站点侧更新子模块指针并重新 `hexo generate` 验证。

## 5. 发版自检清单

- [ ] `hexo clean && hexo generate` 无 FATAL，页面数量与预期一致
- [ ] 新增配置项同时写入主题 `_config.yml`（默认模板）和站点根 `_config.butterfly.yml`（实际值）
- [ ] 修改过 pjax / 文章容器的脚本，需验证：直接打开、站内跳转（pjax）、后退/前进三种路径
- [ ] 移动端（窄屏）确认表格、目录、评论区等关键区块未错位
- [ ] `CHANGELOG.md` 与 `package.json` 版本号一致

## 6. 撤回（YANKED）

因重大 bug 或安全问题撤回的版本，保留条目并在标题后加标注：

```
## [4.5.1] - 2026-10-01 [YANKED]
```

已发布的 tag 不允许改写内容，只能发新版本修正。
