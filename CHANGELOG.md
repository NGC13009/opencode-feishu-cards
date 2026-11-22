# 更新日志

本插件遵循 [语义化版本](https://semver.org/lang/zh-CN/)，版本号以 `package.json` 的 `version` 为唯一来源。

## 1.0.0 - 2026-11-22

- 首个公开发布版本，包名 `opencode-feishu-cards`，发布到 npm。
- 功能与 `0.1.0` 一致，按正式发布整理包元数据：新增 `files` 白名单、`description`、`license` 与 `keywords`，补上 `LICENSE` 文件。
- `@opencode/plugin` 改为运行时依赖，TUI 入口在安装后的包中可以直接解析。

## 0.1.0 - 2026-11-22

- 首个版本，在 OpenCode `2.3.2` 上验证。
- 单向飞书通知：任务完成、出错、用户打断、权限请求、提问、计划完成、会话开始、用户消息、客户端连接。
- TUI 侧栏开关与 `/feishu on|off|toggle|status` 指令。
- 飞书卡片使用 Card JSON 2.0，长内容自动分段并补全代码围栏。
