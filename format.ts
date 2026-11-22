export type CardColor = "green" | "red" | "orange" | "blue" | "grey"

export interface Notification {
  title: string
  body: string
  color: CardColor
}

export interface CompletionInput {
  sessionTitle: string
  summary: string | null
  subagent: boolean
}

export interface ErrorInput {
  sessionTitle: string
  message: string
  subagent: boolean
}

export interface PermissionInput {
  sessionTitle: string | null
  action: string
  resources: readonly string[]
}

export interface QuestionInput {
  sessionTitle: string | null
  title: string
  fields: readonly { title?: string; key: string; options?: readonly { label: string }[] }[]
}

export function truncate(text: string, maxChars: number): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (maxChars <= 0) return ""
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

/** 截断 Markdown 时尽量保持语法完整，特别是不要把围栏代码块截成未闭合状态。maxChars 为 0 表示不截断。 */
export function truncateMarkdown(text: string, maxChars: number): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (maxChars <= 0) return normalized
  if (normalized.length <= maxChars) return normalized

  let cut = normalized.slice(0, Math.max(0, maxChars - 1))
  const lastNewline = cut.lastIndexOf("\n")
  if (lastNewline > cut.length * 0.6) cut = cut.slice(0, lastNewline)
  cut = cut.trimEnd()

  const fenceCount = cut.split("\n").filter((line) => /^\s*```/.test(line)).length
  if (fenceCount % 2 === 1) return `${cut}\n\`\`\`\n…`
  return `${cut}…`
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 1) return "不到 1 秒"
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 从会话消息里取最后一条包含正文的 assistant 消息，作为任务结果摘要。 */
export function extractAssistantSummary(messages: readonly unknown[], maxChars: number): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.type !== "assistant" || !Array.isArray(message.content)) continue
    const texts = message.content
      .filter((part): part is { type: string; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter((text) => text.length > 0)
    if (texts.length === 0) continue
    const summary = truncateMarkdown(texts.join("\n\n"), maxChars)
    if (summary.length > 0) return summary
  }
  return null
}

/** 最后一条用户消息的时间，用作本回合耗时起点。 */
export function lastUserMessageTime(messages: readonly unknown[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.type !== "user" || !isRecord(message.time)) continue
    const created = message.time.created
    if (typeof created === "number" && Number.isFinite(created)) return created
  }
  return null
}

/**
 * 卡片标题统一为 `[OpenCode] - 会话标题 - 消息来源`。
 * 来源写在标题栏，正文只承载内容，不再重复状态标题。
 */
function headline(sessionTitle: string | null, source: string): string {
  const parts = ["[OpenCode]"]
  const title = sessionTitle?.trim()
  if (title) parts.push(title)
  parts.push(source)
  return truncate(parts.join(" - "), 160)
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n")
}

export function buildCompletionNotification(input: CompletionInput): Notification {
  return {
    title: headline(input.sessionTitle, "完成"),
    body: input.summary?.trim() ?? "",
    color: "green",
  }
}

export function buildErrorNotification(input: ErrorInput): Notification {
  return {
    title: headline(input.sessionTitle, input.subagent ? "子代理出错" : "出错"),
    body: input.message.trim() || "未知错误",
    color: "red",
  }
}

export function buildPermissionNotification(input: PermissionInput): Notification {
  const resources = bulletList(input.resources)
  const body = [
    `**操作**：${input.action}`,
    resources ? `**资源**\n\n${resources}` : "",
  ].filter(Boolean).join("\n\n")
  return {
    title: headline(input.sessionTitle, "授权"),
    body,
    color: "orange",
  }
}

export function buildQuestionNotification(input: QuestionInput): Notification {
  const fields = input.fields
    .map((field) => {
      const label = field.title ?? field.key
      const options = field.options?.map((option) => option.label).join(" / ")
      return options ? `- ${label}（${options}）` : `- ${label}`
    })
    .join("\n")
  const body = [input.title, fields].filter(Boolean).join("\n\n")
  return {
    title: headline(input.sessionTitle, "询问"),
    body,
    color: "blue",
  }
}

export interface SessionNotificationInput {
  sessionTitle: string | null
}

export function buildSessionStartedNotification(input: SessionNotificationInput): Notification {
  return {
    title: headline(input.sessionTitle, "开始"),
    body: "",
    color: "blue",
  }
}

export function buildUserMessageNotification(input: SessionNotificationInput & { text: string | null }): Notification {
  return {
    title: headline(input.sessionTitle, "用户"),
    body: input.text?.trim() ?? "",
    color: "blue",
  }
}

export function buildInterruptedNotification(input: SessionNotificationInput & { reason: string; cancelled: boolean }): Notification {
  return {
    title: headline(input.sessionTitle, input.cancelled ? "取消" : "中断"),
    body: input.cancelled ? "" : `原因：${input.reason}`,
    color: "grey",
  }
}

export function buildPlanExitNotification(input: SessionNotificationInput): Notification {
  return {
    title: headline(input.sessionTitle, "计划"),
    body: "",
    color: "orange",
  }
}

export function buildConnectedNotification(): Notification {
  return {
    title: headline(null, "已连接"),
    body: "",
    color: "grey",
  }
}
