import type { ReceiverType } from "./config"
import type { Notification } from "./format"

export interface FeishuClientOptions {
  appId: string
  appSecret: string
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

export interface SendNotificationInput extends Notification {
  receiverId: string
  receiverType: ReceiverType
  /** Feishu 幂等键，同一条消息重复发送时最多成功一次。最长 50 字符。 */
  uuid?: string
}

interface FeishuResponse {
  code?: number
  msg?: string
  [key: string]: unknown
}

const TOKEN_INVALID_CODES = new Set([99991661, 99991663, 99991664])

/**
 * 单张卡片正文的字符上限。内容超过时会拆成多条卡片依次发送，
 * 而不是丢弃超出部分。3 500 个中文字符约 10 KB，远低于飞书消息体大小限制。
 */
const MAX_CARD_CHARS = 3_500

/** 代码围栏的起始行，可能带语言标记，例如 ```ts */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*\S*$/
/** 代码围栏的结束行，只有围栏符号 */
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(text.slice(0, middle), "utf8") <= maxBytes) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low).trimEnd()}…`
}

/** 按字符切分超长单行，避免拆坏代理对（emoji）。 */
function hardSplit(line: string, maxChars: number): string[] {
  const parts: string[] = []
  let current = ""
  for (const char of line) {
    if (current.length + char.length > maxChars) {
      parts.push(current)
      current = ""
    }
    current += char
  }
  if (current) parts.push(current)
  return parts
}

/**
 * 把 Markdown 切成不超过 maxChars 的若干段。
 * 跨卡片拆分时会在上一段补上结束围栏、在下一段重新打开围栏，保证代码块语法完整。
 * maxChars 为 0 时表示不拆分。
 */
export function splitMarkdown(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (normalized.length === 0) return [""]
  if (maxChars <= 0) return [normalized]

  const chunks: string[] = []
  let buffer: string[] = []
  let size = 0
  let fence: string | null = null

  const hasBody = () => buffer.length > (fence ? 1 : 0)

  const flush = () => {
    if (!hasBody()) return
    if (fence) {
      const marker = fence.startsWith("~") ? "~~~" : "```"
      chunks.push(`${buffer.join("\n")}\n${marker}`)
      buffer = [fence]
      size = fence.length
    } else {
      chunks.push(buffer.join("\n"))
      buffer = []
      size = 0
    }
  }

  const append = (piece: string) => {
    if (buffer.length > 0) size += 1
    buffer.push(piece)
    size += piece.length
  }

  for (const line of normalized.split("\n")) {
    if (hasBody() && size + 1 + line.length > maxChars) flush()

    if (line.length > maxChars) {
      for (const piece of hardSplit(line, maxChars)) {
        if (hasBody() && size + 1 + piece.length > maxChars) flush()
        append(piece)
      }
    } else {
      append(line)
    }

    if (fence && FENCE_CLOSE.test(line)) fence = null
    else if (!fence && FENCE_OPEN.test(line)) fence = line.trim()
  }

  flush()
  return chunks
}

function buildCard(input: SendNotificationInput, body: string): Record<string, unknown> {
  // 没有正文的事件（开始、计划、已连接等）只显示标题栏。
  const elements = body.trim() ? [{ tag: "markdown", content: body, text_size: "normal" }] : []
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "fill" },
    header: {
      template: input.color,
      title: { tag: "plain_text", content: input.title },
    },
    body: { elements },
  }
}

/**
 * 最小的飞书自建应用客户端：只负责 tenant_access_token 缓存和发送卡片消息。
 * 所有失败都抛出异常，由调用方决定是否记录日志，不影响 OpenCode 主流程。
 */
export function createFeishuClient(options: FeishuClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  const now = options.now ?? Date.now
  const baseUrl = options.baseUrl.replace(/\/+$/, "")

  let token: { value: string; expiresAt: number } | null = null
  let refreshing: Promise<string> | null = null

  async function postJson(url: string, body: unknown, accessToken?: string): Promise<{ response: Response; json: FeishuResponse }> {
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let json: FeishuResponse
    try {
      const parsed: unknown = JSON.parse(text)
      json = isRecord(parsed) ? parsed : {}
    } catch {
      throw new Error(`飞书接口返回了非 JSON 内容（HTTP ${response.status}）：${truncateToBytes(text, 300)}`)
    }
    return { response, json }
  }

  async function refreshToken(): Promise<string> {
    const url = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal/`
    const { response, json } = await postJson(url, { app_id: options.appId, app_secret: options.appSecret })
    if (!response.ok || json.code !== 0 || typeof json.tenant_access_token !== "string") {
      throw new Error(`获取飞书 tenant_access_token 失败（HTTP ${response.status}，code ${String(json.code ?? "?")}）：${String(json.msg ?? "未知错误")}`)
    }
    const expireSeconds = typeof json.expire === "number" && Number.isFinite(json.expire) ? json.expire : 7200
    const lifetimeMs = Math.max(60, expireSeconds - 120) * 1000
    token = { value: json.tenant_access_token, expiresAt: now() + lifetimeMs }
    return token.value
  }

  async function getToken(force = false): Promise<string> {
    if (!force && token && now() < token.expiresAt) return token.value
    if (refreshing) return refreshing
    refreshing = refreshToken()
    try {
      return await refreshing
    } finally {
      refreshing = null
    }
  }

  async function sendOnce(payload: SendNotificationInput, accessToken: string): Promise<{ response: Response; json: FeishuResponse }> {
    const query = `?receive_id_type=${encodeURIComponent(payload.receiverType)}`
    const body: Record<string, unknown> = {
      receive_id: payload.receiverId,
      msg_type: "interactive",
      content: JSON.stringify(buildCard(payload, payload.body)),
    }
    if (payload.uuid) body.uuid = payload.uuid.slice(0, 50)
    return postJson(`${baseUrl}/open-apis/im/v1/messages${query}`, body, accessToken)
  }

  async function sendPart(input: SendNotificationInput, body: string, index: number, total: number): Promise<void> {
    const title = total > 1 ? `${input.title}（${index + 1}/${total}）` : input.title
    // 每段使用不同幂等键，否则飞书会把后续分段当成重复消息丢弃。
    const uuid = input.uuid && total > 1 ? `${input.uuid.slice(0, 40)}#${index + 1}` : input.uuid
    const payload: SendNotificationInput = { ...input, title, body, uuid }

    let result = await sendOnce(payload, await getToken())
    const tokenRejected = result.response.status === 401 || (typeof result.json.code === "number" && TOKEN_INVALID_CODES.has(result.json.code))
    if (tokenRejected) {
      result = await sendOnce(payload, await getToken(true))
    }
    if (!result.response.ok || result.json.code !== 0) {
      throw new Error(`发送飞书消息失败（HTTP ${result.response.status}，code ${String(result.json.code ?? "?")}）：${String(result.json.msg ?? "未知错误")}`)
    }
  }

  async function sendNotification(input: SendNotificationInput): Promise<void> {
    const parts = splitMarkdown(input.body, MAX_CARD_CHARS)
    for (let index = 0; index < parts.length; index += 1) {
      await sendPart(input, parts[index], index, parts.length)
    }
  }

  return { sendNotification }
}

export type FeishuClient = ReturnType<typeof createFeishuClient>
