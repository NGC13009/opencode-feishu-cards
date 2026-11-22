import type { NotifierConfig } from "./config"
import type { EventRules } from "./events"
import {
  buildCompletionNotification,
  buildConnectedNotification,
  buildErrorNotification,
  buildInterruptedNotification,
  buildPermissionNotification,
  buildPlanExitNotification,
  buildQuestionNotification,
  buildSessionStartedNotification,
  buildUserMessageNotification,
  extractAssistantSummary,
  lastUserMessageTime,
} from "./format"
import type { SendNotificationInput } from "./feishu"

export interface EventLocation {
  directory: string
  workspaceID?: string
}

export interface NotifierEvent {
  id: string
  type: string
  location?: EventLocation
  data: unknown
}

export interface SessionInfoLike {
  parentID?: string
  title?: string
}

export interface NotifierDeps {
  config: NotifierConfig
  events: EventRules
  locationDirectory: string
  locationWorkspaceID?: string
  isEnabled?: () => boolean
  getSession: (sessionID: string) => Promise<SessionInfoLike>
  getMessages: (sessionID: string) => Promise<readonly unknown[]>
  permissionPending?: (sessionID: string, requestID: string) => Promise<boolean>
  send: (input: SendNotificationInput) => Promise<void>
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function normalizeDirectory(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

/** 防止同一事件被重复处理；只需记住最近的一小段。 */
function createSeen(limit = 512) {
  const ids = new Set<string>()
  const order: string[] = []
  return (id: string): boolean => {
    if (ids.has(id)) return false
    ids.add(id)
    order.push(id)
    if (order.length > limit) {
      const oldest = order.shift()
      if (oldest !== undefined) ids.delete(oldest)
    }
    return true
  }
}

export function createEventHandler(deps: NotifierDeps) {
  const now = deps.now ?? Date.now
  const seen = createSeen()
  const { config, events } = deps

  function sameLocation(event: NotifierEvent): boolean {
    if (!event.location) return true
    if (normalizeDirectory(event.location.directory) !== normalizeDirectory(deps.locationDirectory)) return false
    if (deps.locationWorkspaceID && event.location.workspaceID && event.location.workspaceID !== deps.locationWorkspaceID) return false
    return true
  }

  async function readSession(sessionID: string): Promise<SessionInfoLike | null> {
    try {
      return await deps.getSession(sessionID)
    } catch (error) {
      deps.log?.(`读取会话 ${sessionID} 信息失败，按主会话处理`, error)
      return null
    }
  }

  async function readMessages(sessionID: string): Promise<readonly unknown[]> {
    try {
      return await deps.getMessages(sessionID)
    } catch (error) {
      deps.log?.(`读取会话 ${sessionID} 消息失败，将不包含结果摘要`, error)
      return []
    }
  }

  async function send(input: SendNotificationInput, eventID: string): Promise<void> {
    try {
      await deps.send({ ...input, uuid: eventID })
    } catch (error) {
      deps.log?.(`发送飞书通知失败：${input.title}`, error)
    }
  }

  function titleOf(info: SessionInfoLike | null, fallback: string | null): string | null {
    return info?.title?.trim() || fallback
  }

  async function onComplete(event: NotifierEvent): Promise<void> {
    const data = isRecord(event.data) ? event.data : {}
    const sessionID = readString(data, "sessionID")
    if (!sessionID) return

    const info = await readSession(sessionID)
    const subagent = Boolean(info?.parentID)
    if (!(subagent ? events.subagent_complete : events.complete)) return

    const messages = await readMessages(sessionID)
    const startedAt = lastUserMessageTime(messages)
    const elapsedMs = startedAt === null ? null : Math.max(0, now() - startedAt)
    if (config.minDurationSeconds > 0 && elapsedMs !== null && elapsedMs < config.minDurationSeconds * 1000) return

    const summary = extractAssistantSummary(messages, config.summaryChars)
    const notification = buildCompletionNotification({
      sessionTitle: titleOf(info, sessionID) ?? sessionID,
      summary,
      subagent,
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onError(event: NotifierEvent): Promise<void> {
    if (!events.error) return
    const data = isRecord(event.data) ? event.data : {}
    const sessionID = readString(data, "sessionID")
    if (!sessionID) return

    const info = await readSession(sessionID)
    const error = isRecord(data.error) ? data.error : {}
    const notification = buildErrorNotification({
      sessionTitle: titleOf(info, sessionID) ?? sessionID,
      message: readString(error, "message") ?? readString(data, "message") ?? "未知错误",
      subagent: Boolean(info?.parentID),
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onPermission(event: NotifierEvent): Promise<void> {
    if (!events.permission) return
    const data = isRecord(event.data) ? event.data : {}
    const sessionID = readString(data, "sessionID")
    const requestID = readString(data, "id")
    if (sessionID && requestID && deps.permissionPending) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (!(await deps.permissionPending(sessionID, requestID))) return
    }
    const info = sessionID ? await readSession(sessionID) : null
    const notification = buildPermissionNotification({
      sessionTitle: titleOf(info, null),
      action: readString(data, "action") ?? "未知操作",
      resources: readStringArray(data, "resources"),
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onForm(event: NotifierEvent): Promise<void> {
    if (!events.question) return
    const data = isRecord(event.data) ? event.data : {}
    const form = isRecord(data.form) ? data.form : {}
    const metadata = isRecord(form.metadata) ? form.metadata : {}
    if (metadata.kind !== "question") return

    const sessionID = readString(form, "sessionID")
    if (!sessionID || sessionID === "global") return
    const info = await readSession(sessionID)
    const fields = Array.isArray(form.fields)
      ? form.fields.flatMap((field) => {
          if (!isRecord(field)) return []
          const key = readString(field, "key")
          if (!key) return []
          const title = readString(field, "title")
          const options = Array.isArray(field.options)
            ? field.options.flatMap((option) => {
                if (!isRecord(option)) return []
                const label = readString(option, "label")
                return label ? [{ label }] : []
              })
            : undefined
          return [{ key, title, options }]
        })
      : []

    const notification = buildQuestionNotification({
      sessionTitle: titleOf(info, null),
      title: readString(form, "title") ?? "需要你回答问题",
      fields,
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onInterrupted(event: NotifierEvent): Promise<void> {
    const data = isRecord(event.data) ? event.data : {}
    const reason = readString(data, "reason") ?? "unknown"
    const cancelled = reason === "user"
    if (!(cancelled ? events.user_cancelled : events.interrupted)) return
    const sessionID = readString(data, "sessionID")
    if (!sessionID) return

    const info = await readSession(sessionID)
    const notification = buildInterruptedNotification({
      sessionTitle: titleOf(info, null),
      reason,
      cancelled,
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onSessionCreated(event: NotifierEvent): Promise<void> {
    if (!events.session_started) return
    const data = isRecord(event.data) ? event.data : {}
    if (readString(data, "parentID")) return
    const sessionID = readString(data, "sessionID")
    if (!sessionID) return
    const title = readString(data, "title") ?? null
    const info = title ? null : await readSession(sessionID)
    const notification = buildSessionStartedNotification({
      sessionTitle: title ?? titleOf(info, null),
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onUserMessage(event: NotifierEvent): Promise<void> {
    if (!events.user_message) return
    const data = isRecord(event.data) ? event.data : {}
    const item = isRecord(data.item) ? data.item : {}
    if (item.type !== "user") return
    const sessionID = readString(data, "sessionID")
    if (!sessionID) return
    const info = await readSession(sessionID)
    if (info?.parentID) return
    const payload = isRecord(item.payload) ? item.payload : {}
    const notification = buildUserMessageNotification({
      sessionTitle: titleOf(info, null),
      text: readString(payload, "text") ?? null,
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onPlanExit(event: NotifierEvent): Promise<void> {
    if (!events.plan_exit) return
    const data = isRecord(event.data) ? event.data : {}
    const sessionID = readString(data, "sessionID")
    if (!sessionID) return
    const info = await readSession(sessionID)
    const notification = buildPlanExitNotification({
      sessionTitle: titleOf(info, null),
    })
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  async function onConnected(event: NotifierEvent): Promise<void> {
    if (!events.client_connected) return
    const notification = buildConnectedNotification()
    await send({ ...notification, receiverId: config.receiverId, receiverType: config.receiverType }, event.id)
  }

  return async function handleEvent(event: NotifierEvent): Promise<void> {
    if (deps.isEnabled && !deps.isEnabled()) return
    if (!seen(event.id)) return
    if (!sameLocation(event)) return

    switch (event.type) {
      case "session.execution.succeeded":
        await onComplete(event)
        break
      case "session.execution.failed":
        await onError(event)
        break
      case "session.execution.interrupted":
        await onInterrupted(event)
        break
      case "permission.asked":
        await onPermission(event)
        break
      case "form.created":
        await onForm(event)
        break
      case "session.created":
        await onSessionCreated(event)
        break
      case "session.inbox.enqueued":
        await onUserMessage(event)
        break
      case "plan_exit":
        await onPlanExit(event)
        break
      case "client_connected":
        await onConnected(event)
        break
      default:
        break
    }
  }
}
