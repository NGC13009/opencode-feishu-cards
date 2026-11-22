import type { Plugin } from "@opencode/plugin"
import { parseConfig } from "./config"
import { readEventRules } from "./events"
import { createFeishuClient } from "./feishu"
import { createEventHandler } from "./notify"
import { readNotifyState } from "./state"
import { VERSION } from "./version"

const LOG_PREFIX = "[feishu-notify]"

function logError(message: string, error?: unknown): void {
  if (error === undefined) console.error(`${LOG_PREFIX} ${message}`)
  else console.error(`${LOG_PREFIX} ${message}`, error)
}

function logInfo(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`)
}

export default {
  id: "feishu-notify",
  async setup(ctx) {
    logInfo(`v${VERSION} 已加载`)
    const parsed = parseConfig(ctx.options as unknown as Record<string, unknown>)
    if (!parsed.ok) {
      logError(`${parsed.error}，插件已停用`)
      return
    }

    const config = parsed.config
    const eventRules = readEventRules()
    if (eventRules.error) {
      logError(`读取 ${eventRules.path} 失败，使用默认事件配置：${eventRules.error}`)
    }

    const client = createFeishuClient({
      appId: config.appId,
      appSecret: config.appSecret,
      baseUrl: config.baseUrl,
    })

    const location = {
      directory: ctx.location.directory,
      workspaceID: ctx.location.workspaceID,
    }

    const handleEvent = createEventHandler({
      config,
      events: eventRules.rules,
      locationDirectory: ctx.location.directory,
      locationWorkspaceID: ctx.location.workspaceID,
      getSession: (sessionID) => ctx.session.get({ sessionID }),
      getMessages: (sessionID) => ctx.session.context({ sessionID }),
      permissionPending: async (sessionID, requestID) => {
        const pending = await ctx.permission.list({ sessionID })
        return pending.some((request) => request.id === requestID)
      },
      send: (input) => client.sendNotification(input),
      isEnabled: () => readNotifyState().enabled,
      log: logError,
    })

    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "plan_exit") return
      await handleEvent({
        id: `plan_exit:${event.id}`,
        type: "plan_exit",
        location,
        data: { sessionID: event.sessionID },
      })
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: [
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
            "permission.asked",
            "form.created",
            "session.created",
            "session.inbox.enqueued",
          ],
          signal: controller.signal,
        })) {
          await handleEvent(event)
        }
      } catch (error) {
        if (!controller.signal.aborted) logError("事件订阅中断", error)
      }
    })()

    void handleEvent({
      id: `client_connected:${process.pid}:${Date.now()}`,
      type: "client_connected",
      location,
      data: {},
    })

    return () => controller.abort()
  },
} satisfies Plugin.Plugin
