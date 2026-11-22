# 适用于 OpenCode 的简单飞书通知插件

在任务完成、出错、需要授权或需要回答问题时，通过飞书自建应用机器人推送一张卡片消息。只做单向通知，不接收飞书消息，也不依赖 webhook 或公网回调地址。

适用于 OpenCode V2，已在 `2.3.2` 上验证。不适用于OpenCode V1。npm 包名：`opencode-feishu-cards`。

**本插件的典型用户场景**：给OpenCode发送一个需要一直执行很久的任务，然后用户可能离开计算机，出去在附近买个奶茶，或者出去在附近玩……但是希望通过手机上的飞书立刻得知OpenCode的任务结束消息，以及任务简报，以便于恰当的时候随时回来继续。
用户认为没必要通过手机去控制计算机上的OpenCode执行新的任务，因为任务效果等还是需要坐在电脑面前仔细查看的，手机屏幕还是太小了不方便……因此一些把OpenCode改装成openclaw的东西还是太过于笨重并且天天升级不够稳定，希望找到更轻量简洁的方法去实现所需功能。

本插件支持：

1. 随时在TUI侧栏开启或者关闭任务情况向飞书的消息推送通知
2. 格式化渲染任务结束时的文本
3. 设定接收哪些完成消息通知（完成/询问/错误等）

本插件**不**支持：

1. 在飞书上给OpenCode发送指令
2. 在飞书上控制OpenCode的消息推送开关

## 快速开始

### 1. 创建飞书自建应用

1. 在[飞书开放平台](https://open.feishu.cn/app)创建企业自建应用。
2. 在「添加应用能力」中开启机器人能力。
3. 在「权限管理」中开通以下任一权限：
    - `im:message`
    - `im:message:send_as_bot`
4. 如果 `receiverType` 使用 `user_id`，还需要开通 `contact:user.employee_id:readonly`；使用 `email`、`open_id` 或 `chat_id` 时不需要。
5. 在「版本管理与发布」中创建版本并发布，把接收人加入应用可用范围；如果发到群聊，把机器人拉进目标群。
6. 记录「凭证与基础信息」中的 `App ID` 和 `App Secret`。

本插件只发送消息，不需要订阅事件，也不需要使用长连接或回调地址。

当然，你可以复用一个你已经在使用的飞书机器人/智能体用于投递消息（注意，消息上下文是共享的，这可能影响智能体的正常工作。针对并非仅作为推送渠道的机器人/智能体请谨慎共享）

### 2. 安装插件

```powershell
opencode plugin add opencode-feishu-cards@^1.0.0
```

`opencode plugin add` 会把包写入全局配置，但它只写入不带凭证的条目。打开 `~/.config/opencode/opencode.json(c)`，把新增的条目改写成对象形式并填入凭证：

```jsonc
{
  "plugins": [
    {
      "package": "opencode-feishu-cards",
      "options": {
        "appId": "cli_xxx",
        "appSecret": "${FEISHU_APP_SECRET}",
        "receiverId": "you@company.com",
        "receiverType": "email"
      }
    }
  ]
}
```

也可以跳过 CLI，直接把上面的对象条目写进全局或项目的 `opencode.json(c)`。

`@^1.0.0` 形式的字符串条目会跟随次版本自动更新；改成对象形式后包名不再带范围，需要更新时执行 `opencode plugin update`。

也可以支持`open_id`，`user_id`等方式调用（记得在飞书开发后台开放权限）。

#### 本地目录安装

修改源码或离线使用时，可以直接引用本仓库目录：

```jsonc
{
  "plugins": [
    {
      "package": "/path/to/OpenCode飞书插件",
      "options": {
        "appId": "cli_xxx",
        "appSecret": "${FEISHU_APP_SECRET}",
        "receiverId": "you@company.com",
        "receiverType": "email"
      }
    }
  ]
}
```

也可以把运行时文件复制到全局插件目录，再使用相对路径：

路径情况：

```text
~/.config/opencode/plugins/opencode-feishu-cards/
├── index.ts
├── config.ts
├── events.ts
├── feishu.ts
├── format.ts
├── notify.ts
├── paths.ts
├── state.ts
├── tui.tsx
├── version.ts
└── package.json
```

opencode.jsonc:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/opencode-feishu-cards",
      "options": {
        "appId": "cli_xxx",
        "appSecret": "${FEISHU_APP_SECRET}",
        "receiverId": "you@company.com",
        "receiverType": "email"
      }
    }
  ]
}
```

本地目录方式运行时不需要 `node_modules`，它只用于开发和测试。`package.json` 必须随插件一起复制：插件版本从它的 `version` 字段读取。从 npm 安装时由 OpenCode 自动安装依赖。

`appSecret` 支持 `${ENV_NAME}` 形式的环境变量引用。也可以直接写字符串，但不要把包含真实密钥的配置提交到仓库。

OpenCode 会自动加载配置变更。修改插件源码后，执行 `opencode service restart` 重新加载。

## 配置项

| 选项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `appId` | string | 必填 | 飞书自建应用 App ID |
| `appSecret` | string | 必填 | 飞书自建应用 App Secret，支持 `${ENV_NAME}` |
| `receiverId` | string | 必填 | 接收者 ID，类型由 `receiverType` 决定 |
| `receiverType` | string | 自动推断 | `open_id`、`union_id`、`user_id`、`email`、`chat_id` 之一 |
| `baseUrl` | string | `https://open.feishu.cn` | 飞书开放平台地址，Lark 国际版可设为 `https://open.larksuite.com` |
| `minDurationSeconds` | number | `0` | 主会话耗时低于该值时跳过完成通知，`0` 表示不限制 |
| `summaryChars` | number | `0` | 完成通知正文的最大字符数，`0` 表示不限制，最大可设为 `5000` |

事件类型由独立的 `feishu-notify.json` 控制，见下一节。

`receiverType` 未填写时按 `receiverId` 推断：`oc_` 开头为 `chat_id`，`ou_` 为 `open_id`，`on_` 为 `union_id`，包含 `@` 为 `email`，其余为 `user_id`。

## TUI 控制

插件同时包含 TUI 部分，会随服务端插件自动加载，不需要在 `cli.json` 中单独配置。

- 会话侧栏显示 `飞书通知：开/关`，点击即可切换。
- `/feishu` 显示当前状态和插件版本。
- `/feishu on` 开启通知。
- `/feishu off` 关闭通知。
- `/feishu toggle` 切换通知。

状态保存在 `~/.local/share/opencode/feishu-notify-state.json`，默认开启。服务端在每次推送前读取该文件，因此切换后立即生效，不需要重启 OpenCode。删除该文件即可恢复默认开启。

按钮和指令控制的是本机文件；如果 TUI 连接的是远程 OpenCode 服务器，本机切换不会影响远程服务端。

## 事件选择

事件类型由 `~/.config/opencode/feishu-notify.json` 控制：

```json
{
  "events": {
    "permission": {   // 权限请求通知
      "notification": true
    },
    "complete": {     // 完成通知
      "notification": true
    },
    "error": {  // 错误通知
      "notification": true
    },
    "question": { // 询问通知
      "notification": true
    },
    "interrupted": { // 用户打断通知
      "notification": true
    },
    "user_cancelled": { // 用户取消通知
      "notification": true
    },
    "plan_exit": { // 计划完成通知
      "notification": true
    },
    "session_started": { // 会话开始通知
      "notification": true
    },
    "user_message": { // 用户输入消息（开启后有望在飞书上获得更完整的上下文，对于健忘症患者很有效）
      "notification": true
    },
    "client_connected": { // 客户端连接提示，成功连接可以发送一次消息，开启后可以避免实际上失去发送能力而用户不知情导致无人值守造成的惨剧
      "notification": true
    },
    "subagent_complete": { // 子助理任务完成通知，不建议开启，子助理的老板是父助理，不是用户，开启后消息通知会非常烦人的变多，没必要
      "notification": false
    }
  }
}
```

每个事件可以写成布尔值，也可以写成 `{ "notification": boolean }`。`notification` 为 `true` 时才推送到飞书；`sound`、`bell` 等与飞书无关的字段会被忽略。顶层直接写 `"complete": true` 也兼容。

| 事件键 | 对应时机 |
| :--- | :--- |
| `permission` | `permission.asked` |
| `complete` | 主会话 `session.execution.succeeded` |
| `subagent_complete` | 子代理 `session.execution.succeeded` |
| `error` | `session.execution.failed` |
| `question` | `form.created` 且 `metadata.kind` 为 `question` |
| `interrupted` | `session.execution.interrupted`，原因为非 `user` |
| `user_cancelled` | `session.execution.interrupted`，原因为 `user` |
| `plan_exit` | `plan_exit` 工具调用前 |
| `session_started` | 主会话 `session.created` |
| `user_message` | 主会话 `session.inbox.enqueued` 的用户消息 |
| `client_connected` | 插件加载时 |

文件不存在时使用内置默认值（注意这不是上面给出的示例值。我建议还是手动设置所有情况的值比较好）；JSON 解析失败时保留默认值并在 OpenCode 日志中输出原因。

TUI 的开关是总开关：关闭后，无论 `feishu-notify.json` 中启用了哪些事件，都不会发送飞书消息。

## 接收者 ID

- 个人邮箱：直接填写飞书账号邮箱，`receiverType` 为 `email`。该用户必须在应用可用范围内。
- 群聊：把机器人拉进群，填写群 ID，`receiverType` 为 `chat_id`。
- 单聊：填写用户 `open_id`，`receiverType` 为 `open_id`。可在飞书开放平台 API 调试台的「发送消息」接口中快速获取。
- 用户 ID：填写 `user_id`，`receiverType` 为 `user_id`。该方式需要额外开通 `contact:user.employee_id:readonly` 权限。

相关id获取请参阅飞书开放平台文档。

## 通知格式

消息使用飞书卡片，标题统一为：

```text
[OpenCode] - 会话名称 - 消息来源
```

消息来源是本次通知的类型：`完成`、`出错`、`子代理出错`、`授权`、`询问`、`中断`、`取消`、`计划`、`开始`、`用户`、`已连接`。没有会话名称时省略中间部分，例如 `[OpenCode] - 已连接`。

正文只放该事件的内容，不再重复状态标题。插件使用飞书 **Card JSON 2.0** 的 `markdown` 组件，因此支持标题、列表、表格、行内代码和围栏代码块。任务完成时，正文取自最后一条包含正文的 assistant 消息；出错、授权和询问事件会分别给出错误信息、操作与资源、问题与选项；用户消息则是用户发来的原文。开始、计划、已连接等没有内容的事件只显示标题栏。

正文较长时会自动拆成多条卡片依次发送，不会截断内容。此时卡片标题会带上 `（1/3）` 形式的分段序号，每段都会闭合跨段拆分的代码块。

> [!NOTE]
> Card JSON 2.0 需要飞书客户端 7.20 及以上版本。使用更旧版本时，卡片标题会正常显示，正文可能显示为升级提示。代码块、列表和表格需要飞书 7.6 及以上版本。

## 通知触发时机

插件订阅的 OpenCode V2 事件与 `feishu-notify.json` 的对应关系见「事件选择」一节。同一事件只会处理一次。插件实例只处理属于当前工作目录的事件，避免多窗口重复推送。

默认发送完整内容，内容过长时拆成多条卡片，不会截断。如果内容敏感，可以在 `feishu-notify.json` 中关闭 `complete` 事件。

## 故障排查

- 插件没有生效：在 `~/.local/share/opencode/log/opencode.log` 中搜索 `[feishu-notify]`。缺少必填项时会输出明确原因并停用插件。
- 收不到消息：先运行 `bun run test-send`，排除飞书应用配置问题。
- `230013`：接收人不在应用可用范围内。
- `230034`：`receiverId` 与 `receiverType` 不匹配。
- `230002`、`230027`：机器人缺少发送消息权限，或不在群里。
- `99991672`：应用缺少接口要求的权限。使用 `user_id` 时需要 `contact:user.employee_id:readonly`。
- `99991661`、`99991663`：token 失效，插件会自动刷新并重试一次。
- 卡片正文显示升级提示：飞书客户端版本过低，Card JSON 2.0 需要 7.20 及以上版本。
- 网络问题：确认运行 OpenCode 的机器能访问 `baseUrl`。

## 版本

插件遵循语义化版本，版本号的唯一来源是 `package.json` 的 `version`，运行时通过 `version.ts` 导出：

- 启动时在 OpenCode 日志中输出 `[feishu-notify] v<版本> 已加载`。
- TUI 中 `/feishu` 状态提示会带上当前版本。
- 变更记录见 [CHANGELOG.md](CHANGELOG.md)。

发版时只修改 `package.json` 的 `version`，并同步更新 `CHANGELOG.md`，不要在源码里另写版本号。

### 发布准备

需要发版时，可以直接让 AI 执行「发布新版本」的准备流程；AI 只做准备工作，最终发布仍由人工执行。手动执行时按以下顺序：

1. 按语义化版本判断级别：破坏性变更升 major，新功能升 minor，修复与文档升 patch。`0.x` 阶段的破坏性变更也升 minor。
2. 更新版本号，同时同步锁文件：

   ```powershell
   npm version <新版本> --no-git-tag-version
   ```

3. 在 `CHANGELOG.md` 顶部新增 `## <新版本> - <日期>` 小节，按「新增/变更/修复」记录用户可感知的变化。
4. 检查 `README.md` 是否需要跟随：配置项、事件表、文件清单、已验证的 OpenCode 版本。
5. 运行自动检查：

   ```powershell
   bun run check
   ```

   它会执行类型检查与全部测试，并校验 `package.json`、`package-lock.json`、`CHANGELOG.md` 中的版本是否一致。

6. 验证两个入口可以打包：

   ```powershell
   bun build ./index.ts ./tui.tsx --target=bun --outdir .tmp-release --external @opencode/plugin --external @opentui/core --external @opentui/solid --external solid-js
   Remove-Item .tmp-release -Recurse -Force
   ```

7. 检查 npm 包内容，确认只有 `files` 白名单中的运行时文件和文档：

   ```powershell
   npm pack --dry-run
   ```

8. 由人工完成发布：

   ```powershell
   npm login --registry=https://registry.npmjs.org/
   npm publish --tag next --registry=https://registry.npmjs.org/
   # 用 opencode plugin add opencode-feishu-cards@next 验证安装后的包
   npm publish --registry=https://registry.npmjs.org/
   git tag v<新版本>
   git push --follow-tags
   ```

   不要跳过 `next` 预发布验证：`opencode plugin add` 不接受 tarball，只有真实发布后才能验证安装路径。

完整步骤与判断规则见 `.agents/skills/发布新版本.md`。

## 开发

```powershell
bun install
bun run check        # tsc --noEmit && bun test
bun run test-send    # 用真实飞书应用发一条测试消息，需要已配置凭证
```

测试覆盖配置解析、消息格式化、长内容分段与代码围栏补全、飞书客户端（含 token 缓存与失效重试）、通知状态读写、事件过滤、版本一致性，以及从 OpenCode 事件到飞书 HTTP 请求的完整链路。
