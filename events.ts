import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { opencodeConfigDir } from "./paths"

export const EVENT_KEYS = [
  "permission",
  "complete",
  "subagent_complete",
  "error",
  "question",
  "interrupted",
  "user_cancelled",
  "plan_exit",
  "session_started",
  "user_message",
  "client_connected",
] as const

export type EventKey = (typeof EVENT_KEYS)[number]
export type EventRules = Record<EventKey, boolean>

/** 默认值与 opencode-notifier 的默认行为一致：只推送需要用户关注的事件。 */
export const DEFAULT_EVENT_RULES: EventRules = {
  permission: true,
  complete: true,
  subagent_complete: false,
  error: true,
  question: true,
  interrupted: true,
  user_cancelled: true,
  plan_exit: true,
  session_started: false,
  user_message: false,
  client_connected: false,
}

export interface EventRulesResult {
  rules: EventRules
  path: string
  error?: string
}

export function eventRulesPath(): string {
  return process.env.FEISHU_NOTIFY_CONFIG_PATH ?? join(opencodeConfigDir(), "feishu-notify.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 同时接受布尔值和 opencode-notifier 风格的 { notification: boolean }。 */
function readEnabled(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (isRecord(value) && typeof value.notification === "boolean") return value.notification
  return fallback
}

export function readEventRules(): EventRulesResult {
  const path = eventRulesPath()
  const rules: EventRules = { ...DEFAULT_EVENT_RULES }
  if (!existsSync(path)) return { rules, path }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (!isRecord(parsed)) return { rules, path, error: "配置根节点必须是对象" }
    const events = isRecord(parsed.events) ? parsed.events : parsed
    for (const key of EVENT_KEYS) {
      rules[key] = readEnabled(events[key] ?? parsed[key], DEFAULT_EVENT_RULES[key])
    }
    return { rules, path }
  } catch (error) {
    return { rules, path, error: error instanceof Error ? error.message : String(error) }
  }
}
