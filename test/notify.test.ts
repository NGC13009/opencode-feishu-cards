import { describe, expect, test } from "bun:test"
import type { NotifierConfig } from "../config"
import { DEFAULT_EVENT_RULES, type EventRules } from "../events"
import type { SendNotificationInput } from "../feishu"
import { createEventHandler } from "../notify"

const baseConfig: NotifierConfig = {
  appId: "cli_test",
  appSecret: "secret_test",
  receiverId: "someone@example.com",
  receiverType: "email",
  baseUrl: "https://open.feishu.cn",
  minDurationSeconds: 0,
  summaryChars: 600,
}

const location = { directory: "E:/project/demo", workspaceID: "ws1" }

function setup(options?: {
  config?: Partial<NotifierConfig>
  events?: Partial<EventRules>
  sessions?: Record<string, { parentID?: string; title?: string }>
  messages?: Record<string, unknown[]>
  failSend?: boolean
  enabled?: boolean
  permissionPending?: (sessionID: string, requestID: string) => Promise<boolean>
}) {
  const sent: SendNotificationInput[] = []
  const logs: string[] = []
  const sessions = options?.sessions ?? {}
  const messages = options?.messages ?? {}
  const handle = createEventHandler({
    config: { ...baseConfig, ...options?.config },
    events: { ...DEFAULT_EVENT_RULES, ...options?.events },
    locationDirectory: location.directory,
    locationWorkspaceID: location.workspaceID,
    isEnabled: () => options?.enabled ?? true,
    now: () => 66_000,
    getSession: async (sessionID) => {
      const info = sessions[sessionID]
      if (!info) throw new Error("not found")
      return info
    },
    getMessages: async (sessionID) => messages[sessionID] ?? [],
    permissionPending: options?.permissionPending,
    send: async (input) => {
      if (options?.failSend) throw new Error("network down")
      sent.push(input)
    },
    log: (message) => logs.push(message),
  })
  return { handle, sent, logs }
}

let eventCounter = 0
function event(type: string, data: unknown, overrides?: { id?: string; location?: typeof location }) {
  eventCounter += 1
  return {
    id: overrides?.id ?? `evt_${eventCounter}`,
    type,
    data,
    location: overrides?.location ?? location,
  }
}

const successEvent = (sessionID = "ses_main") => event("session.execution.succeeded", { sessionID })

describe("createEventHandler", () => {
  test("主会话完成时发送结果摘要和耗时", async () => {
    const { handle, sent } = setup({
      sessions: { ses_main: { title: "修复登录" } },
      messages: {
        ses_main: [
          { type: "user", time: { created: 1000 } },
          { type: "assistant", content: [{ type: "text", text: "已完成修复" }] },
        ],
      },
    })

    await handle(successEvent())

    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 修复登录 - 完成")
    expect(sent[0].body).toBe("已完成修复")
    expect(sent[0].uuid).toBeDefined()
  })

  test("默认跳过子代理完成通知", async () => {
    const { handle, sent } = setup({
      sessions: { ses_child: { parentID: "ses_main", title: "子任务" } },
    })

    await handle(successEvent("ses_child"))
    expect(sent).toHaveLength(0)
  })

  test("开启 subagent_complete 后通知子代理完成", async () => {
    const { handle, sent } = setup({
      events: { subagent_complete: true },
      sessions: { ses_child: { parentID: "ses_main", title: "子任务" } },
    })

    await handle(successEvent("ses_child"))
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 子任务 - 完成")
  })

  test("低于最短耗时的任务不通知", async () => {
    const { handle, sent } = setup({
      config: { minDurationSeconds: 10 },
      sessions: { ses_main: { title: "短任务" } },
      messages: { ses_main: [{ type: "user", time: { created: 64_000 } }] },
    })

    await handle(successEvent())
    expect(sent).toHaveLength(0)
  })

  test("错误事件通知错误信息", async () => {
    const { handle, sent } = setup({ sessions: { ses_main: { title: "出错会话" } } })

    await handle(event("session.execution.failed", {
      sessionID: "ses_main",
      error: { type: "provider", message: "模型超时" },
    }))

    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 出错会话 - 出错")
    expect(sent[0].body).toBe("模型超时")
  })

  test("权限请求通知操作和资源", async () => {
    const { handle, sent } = setup({ sessions: { ses_main: { title: "会话" } } })

    await handle(event("permission.asked", {
      sessionID: "ses_main",
      action: "shell",
      resources: ["git push *"],
    }))

    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 会话 - 授权")
    expect(sent[0].body).toContain("操作**：shell")
    expect(sent[0].body).toContain("- git push *")
  })

  test("只通知类型为 question 的表单", async () => {
    const { handle, sent } = setup({ sessions: { ses_main: { title: "会话" } } })
    const form = {
      id: "frm_1",
      sessionID: "ses_main",
      title: "选择方案",
      metadata: { kind: "question" },
      fields: [{ key: "plan", title: "方案", type: "string", options: [{ value: "a", label: "A" }] }],
    }

    await handle(event("form.created", { form }))
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 会话 - 询问")
    expect(sent[0].body).toContain("选择方案")

    await handle(event("form.created", { form: { ...form, id: "frm_2", metadata: { kind: "oauth" } } }))
    expect(sent).toHaveLength(1)
  })

  test("同一事件只处理一次", async () => {
    const { handle, sent } = setup({ sessions: { ses_main: { title: "会话" } } })
    const duplicate = successEvent()

    await handle(duplicate)
    await handle(duplicate)
    expect(sent).toHaveLength(1)
  })

  test("忽略其他目录的事件", async () => {
    const { handle, sent } = setup({ sessions: { ses_main: { title: "会话" } } })

    await handle(event("session.execution.succeeded", { sessionID: "ses_main" }, {
      location: { directory: "E:/project/other", workspaceID: "ws2" },
    }))
    expect(sent).toHaveLength(0)
  })

  test("授权请求已被处理时不再通知", async () => {
    const { handle, sent } = setup({
      sessions: { ses_main: { title: "会话" } },
      permissionPending: async () => false,
    })

    await handle(event("permission.asked", {
      sessionID: "ses_main",
      id: "perm_1",
      action: "shell",
      resources: ["ls"],
    }))
    expect(sent).toHaveLength(0)
  })

  test("发送失败只记录日志，不抛异常", async () => {
    const { handle, logs } = setup({ failSend: true, sessions: { ses_main: { title: "会话" } } })

    await expect(handle(successEvent())).resolves.toBeUndefined()
    expect(logs.some((line) => line.includes("发送飞书通知失败"))).toBe(true)
  })

  test("通知关闭时不处理任何事件", async () => {
    const { handle, sent } = setup({
      enabled: false,
      sessions: { ses_main: { title: "会话" } },
      messages: { ses_main: [{ type: "assistant", content: [{ type: "text", text: "结果" }] }] },
    })

    await handle(successEvent())
    await handle(event("permission.asked", { sessionID: "ses_main", action: "shell", resources: ["ls"] }))
    expect(sent).toHaveLength(0)
  })

  test("事件配置可以单独关闭某类通知", async () => {
    const { handle, sent } = setup({
      events: { complete: false, error: true },
      sessions: { ses_main: { title: "会话" } },
      messages: { ses_main: [{ type: "assistant", content: [{ type: "text", text: "结果" }] }] },
    })

    await handle(successEvent())
    expect(sent).toHaveLength(0)

    await handle(event("session.execution.failed", {
      sessionID: "ses_main",
      error: { message: "失败" },
    }))
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toContain("失败")
  })

  test("子代理出错也会通知，与 tray 插件一致", async () => {
    const { handle, sent } = setup({
      sessions: { ses_child: { parentID: "ses_main", title: "子任务" } },
    })

    await handle(event("session.execution.failed", {
      sessionID: "ses_child",
      error: { message: "子任务失败" },
    }))
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 子任务 - 子代理出错")
    expect(sent[0].body).toBe("子任务失败")
  })

  test("用户取消和非用户中断分别使用独立规则", async () => {
    const { handle, sent } = setup({
      sessions: { ses_main: { title: "会话" } },
      events: { user_cancelled: true, interrupted: false },
    })

    await handle(event("session.execution.interrupted", { sessionID: "ses_main", reason: "user" }))
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 会话 - 取消")

    await handle(event("session.execution.interrupted", { sessionID: "ses_main", reason: "shutdown" }))
    expect(sent).toHaveLength(1)
  })

  test("会话开始和用户消息按配置通知", async () => {
    const { handle, sent } = setup({
      events: { session_started: true, user_message: true },
      sessions: { ses_main: { title: "会话" } },
    })

    await handle(event("session.created", { sessionID: "ses_main", title: "新会话" }))
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe("[OpenCode] - 新会话 - 开始")
    expect(sent[0].body).toBe("")

    await handle(event("session.inbox.enqueued", {
      sessionID: "ses_main",
      item: { type: "user", payload: { text: "你好" }, delivery: "steer" },
    }))
    expect(sent).toHaveLength(2)
    expect(sent[1].title).toBe("[OpenCode] - 会话 - 用户")
    expect(sent[1].body).toBe("你好")
  })

  test("计划确认和连接事件按配置通知", async () => {
    const { handle, sent } = setup({
      events: { plan_exit: true, client_connected: true },
      sessions: { ses_main: { title: "会话" } },
    })

    await handle(event("plan_exit", { sessionID: "ses_main" }))
    await handle(event("client_connected", {}))
    expect(sent).toHaveLength(2)
    expect(sent[0].title).toBe("[OpenCode] - 会话 - 计划")
    expect(sent[1].title).toBe("[OpenCode] - 已连接")
  })
})
