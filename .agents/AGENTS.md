# 项目约束

本仓库是 OpenCode V2 的单向飞书通知插件，不是 V1 插件。

- V1 的 `event` hook 在 V2 中不会执行；入口必须是 `{ id, setup(ctx) }`，事件通过 `ctx.event.subscribe()` 订阅。
- `@opencode/plugin` 只用于类型导入，运行时不要 import 它；插件目录在运行时不依赖 `node_modules`。
- 事件语义、schema 字段和验证方法见 `.agents/skills/opencode-v2-plugin-api.md`。
- 修改后至少执行 `bun test` 和 `npx tsc --noEmit`。
- 飞书接口只需要 `App ID` / `App Secret`，不要改成 webhook 方案。
- 版本号单一真相源是 `package.json` 的 `version`，只通过 `version.ts` 导出；发版时同步更新 `CHANGELOG.md`。
- 用户要求「发布新版本」时，按 `.agents/skills/发布新版本.md` 执行准备流程：推导版本号、更新 CHANGELOG、跑 `bun run check`、验证打包；不要执行 commit/tag/push 或任何发布动作，最后交给用户手动发布。
