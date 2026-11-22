export type ReceiverType = "open_id" | "union_id" | "user_id" | "email" | "chat_id"

export interface NotifierConfig {
  appId: string
  appSecret: string
  receiverId: string
  receiverType: ReceiverType
  baseUrl: string
  minDurationSeconds: number
  summaryChars: number
}

export type ParseResult =
  | { ok: true; config: NotifierConfig }
  | { ok: false; error: string }

const RECEIVER_TYPES: readonly ReceiverType[] = ["open_id", "union_id", "user_id", "email", "chat_id"]

const DEFAULTS = {
  baseUrl: "https://open.feishu.cn",
  minDurationSeconds: 0,
  summaryChars: 0,
}

/** 按接收者 ID 的常见前缀推断类型，避免用户填错 receive_id_type。 */
export function inferReceiverType(receiverId: string): ReceiverType {
  if (receiverId.startsWith("oc_")) return "chat_id"
  if (receiverId.startsWith("ou_")) return "open_id"
  if (receiverId.startsWith("on_")) return "union_id"
  if (receiverId.includes("@")) return "email"
  return "user_id"
}

/** 支持 ${ENV_NAME} 形式的环境变量引用，便于把密钥放在环境变量里。 */
function expandEnv(value: string): { ok: true; value: string } | { ok: false; missing: string } {
  let missing = ""
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const replacement = process.env[name]
    if (replacement === undefined) {
      missing = name
      return ""
    }
    return replacement
  })
  return missing ? { ok: false, missing } : { ok: true, value: expanded }
}

function readString(options: Record<string, unknown>, key: string): { ok: true; value?: string } | { ok: false; error: string } {
  const raw = options[key]
  if (raw === undefined || raw === null) return { ok: true }
  if (typeof raw !== "string") return { ok: false, error: `选项 ${key} 必须是字符串` }
  const expanded = expandEnv(raw)
  if (!expanded.ok) return { ok: false, error: `选项 ${key} 引用了未设置的环境变量 ${expanded.missing}` }
  const value = expanded.value.trim()
  return { ok: true, value: value.length > 0 ? value : undefined }
}

function readNumber(options: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number | string {
  const raw = options[key]
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== "number" || !Number.isFinite(raw)) return `选项 ${key} 必须是数字`
  if (raw < min || raw > max) return `选项 ${key} 必须在 ${min} 到 ${max} 之间`
  return raw
}

export function parseConfig(options: Record<string, unknown>): ParseResult {
  const appId = readString(options, "appId")
  if (!appId.ok) return appId
  const appSecret = readString(options, "appSecret")
  if (!appSecret.ok) return appSecret
  const receiverId = readString(options, "receiverId")
  if (!receiverId.ok) return receiverId

  const missing = [
    appId.value ? null : "appId",
    appSecret.value ? null : "appSecret",
    receiverId.value ? null : "receiverId",
  ].filter((item): item is string => item !== null)
  if (missing.length > 0) {
    return { ok: false, error: `缺少必填选项 ${missing.join("、")}（请填写飞书自建应用的 App ID、App Secret 和接收者 ID）` }
  }

  const receiverTypeRaw = readString(options, "receiverType")
  if (!receiverTypeRaw.ok) return receiverTypeRaw
  let receiverType: ReceiverType
  if (receiverTypeRaw.value === undefined) {
    receiverType = inferReceiverType(receiverId.value!)
  } else if ((RECEIVER_TYPES as readonly string[]).includes(receiverTypeRaw.value)) {
    receiverType = receiverTypeRaw.value as ReceiverType
  } else {
    return { ok: false, error: `选项 receiverType 必须是 ${RECEIVER_TYPES.join("、")} 之一` }
  }

  const baseUrlRaw = readString(options, "baseUrl")
  if (!baseUrlRaw.ok) return baseUrlRaw
  const baseUrl = (baseUrlRaw.value ?? DEFAULTS.baseUrl).replace(/\/+$/, "")
  if (!/^https?:\/\/[^/]+/.test(baseUrl)) {
    return { ok: false, error: "选项 baseUrl 必须是 http(s) 地址" }
  }

  const minDurationSeconds = readNumber(options, "minDurationSeconds", DEFAULTS.minDurationSeconds, 0, 86400)
  if (typeof minDurationSeconds === "string") return { ok: false, error: minDurationSeconds }
  const summaryChars = readNumber(options, "summaryChars", DEFAULTS.summaryChars, 0, 5000)
  if (typeof summaryChars === "string") return { ok: false, error: summaryChars }

  return {
    ok: true,
    config: {
      appId: appId.value!,
      appSecret: appSecret.value!,
      receiverId: receiverId.value!,
      receiverType,
      baseUrl,
      minDurationSeconds,
      summaryChars,
    },
  }
}
