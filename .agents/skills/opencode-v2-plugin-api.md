---
name: OpenCode V2 插件与事件 API
description: 在本仓库开发或排查 OpenCode V2 插件时使用，记录 V2 插件入口、事件名称与字段、会话 API、类型查询方法和飞书发送接口要点
---

# OpenCode V2 插件与事件 API

## 插件入口

```ts
import type { Plugin } from "@opencode/plugin"

export default {
  id: "example",
  async setup(ctx) { /* ... */ },
} satisfies Plugin.Plugin
```

- `setup` 返回清理函数；插件卸载时执行。
- `ctx.location.directory` / `ctx.location.workspaceID` 标识插件实例位置，事件流是全局的，需要按位置过滤。
- `ctx.options` 是 `opencode.json(c)` 中 `plugins` 对象的 `options`。
- 类型来自 `@opencode/plugin`，入口类型定义在 `dist/promise/plugin.d.ts`。

## 事件

```ts
for await (const event of ctx.event.subscribe({
  types: ["session.execution.succeeded", "session.execution.failed", "permission.asked", "form.created"],
  signal: controller.signal,
})) { /* ... */ }
```

常用事件的数据形状（`data` 字段）：

| 事件 | 关键字段 |
| :--- | :--- |
| `session.execution.succeeded` | `sessionID` |
| `session.execution.failed` | `sessionID`、`error.message` |
| `session.execution.interrupted` | `sessionID`、`reason`（`user` / `shutdown` / `superseded` / `inactivity`） |
| `permission.asked` | `sessionID`、`id`、`action`、`resources`、`message` |
| `form.created` | `form.sessionID`、`form.title`、`form.metadata.kind`、`form.fields` |

`session.idle` 在 V2 中是 deprecated 的临时事件；优先使用 `session.execution.succeeded`。

## 会话与消息

```ts
const session = await ctx.session.get({ sessionID })      // parentID 非空表示 subagent
const messages = await ctx.session.context({ sessionID }) // 消息数组
```

消息形状：user 消息为 `{ type: "user", time: { created }, text }`；assistant 消息为
`{ type: "assistant", content: [{ type: "text", text }, { type: "tool", ... }] }`。

## 类型查询

V2 类型包没有本地文档时，可直接查 unpkg：

```text
https://unpkg.com/@opencode/plugin@2.3.2/?meta
https://unpkg.com/@opencode/schema@2.3.2/?meta
https://unpkg.com/@opencode/client@2.3.2/?meta
```

事件 schema 在 `@opencode/schema/dist/session-event.js`、`session-status-event.js`、`permission.js`、`form.js`。

## 飞书自建应用

- `POST /open-apis/auth/v3/tenant_access_token/internal/`，body `{ app_id, app_secret }`，返回 `tenant_access_token` 和 `expire`。
- `POST /open-apis/im/v1/messages?receive_id_type=<type>`，header `Authorization: Bearer <token>`。
- body：`{ receive_id, msg_type: "interactive", content: JSON.stringify(card), uuid? }`；`content` 必须是字符串。
- `receive_id_type`：`open_id` / `union_id` / `user_id` / `email` / `chat_id`。
- `user_id` 需要额外权限 `contact:user.employee_id:readonly`。
- 卡片 JSON：Card JSON 2.0，`{ schema: "2.0", header, body: { elements: [{ tag: "markdown", content }] } }`。
- 卡片消息请求体上限约 30 KB；正文过长必须拆成多条消息，不要截断内容。本项目单卡正文上限 `MAX_CARD_CHARS = 3500`，拆分时补全代码围栏。
- `uuid` 是幂等键：同一条消息重复发送只会成功一次。分段发送时每段必须使用不同的 `uuid`，否则后续分段会被飞书静默丢弃。
- `lark_md` 只支持内联子集，不渲染代码块、标题、表格；完整 Markdown 使用 2.0 的 `markdown` 组件。
- Card JSON 2.0 需要飞书客户端 7.20+。
- 权限：`im:message` 或 `im:message:send_as_bot`；接收人需在应用可用范围内。

## TUI 部分

- 包同时导出 `"."`（server）和 `"./tui"`（TUI）时，OpenCode 会自动加载 TUI 部分，无需 `cli.json`。
- TUI 入口：`import { Plugin } from "@opencode/plugin/tui"`，`Plugin.define({ id, setup(context) })`。
- 侧栏插槽：`context.ui.slot({ append: "sidebar.content", render })`；鼠标点击用 OpenTUI 的 `onMouseDown`。
- 斜杠指令：`context.keymap.layer(() => ({ mode: "global", commands: [{ id, slash: { name, arguments: true }, run }] }))`。
- 状态通过 `~/.local/share/opencode/feishu-notify-state.json` 在 server 与 TUI 之间共享；server 每次通知前读取。
- 事件规则放在 `~/.config/opencode/feishu-notify.json`，结构与 tray 的 `opencode-notifier.json` 一致，读取时兼容布尔值和 `{ notification }`。
- 本地 TUI 测试：`bun -e 'import("./tui.tsx")...'` 必须在项目目录执行，才能读到 tsconfig 的 `jsxImportSource`。
