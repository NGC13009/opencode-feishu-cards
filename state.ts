import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface NotifyState {
  enabled: boolean
}

const DEFAULT_STATE: NotifyState = { enabled: true }

/** 状态放在数据目录，避免写配置文件触发 OpenCode 重载；允许用环境变量覆盖，便于测试。 */
export function statePath(): string {
  if (process.env.FEISHU_NOTIFY_STATE_PATH) return process.env.FEISHU_NOTIFY_STATE_PATH
  const dataHome = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "opencode")
    : join(homedir(), ".local", "share", "opencode")
  return join(dataHome, "feishu-notify-state.json")
}

export function readNotifyState(): NotifyState {
  const path = statePath()
  if (!existsSync(path)) return { ...DEFAULT_STATE }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as NotifyState).enabled === "boolean") {
      return { enabled: (parsed as NotifyState).enabled }
    }
  } catch {
    // 文件损坏时按默认开启处理，避免因为通知状态导致插件失效。
  }
  return { ...DEFAULT_STATE }
}

export function writeNotifyState(state: NotifyState): void {
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ enabled: state.enabled }, null, 2)}\n`, "utf8")
  renameSync(temporary, path)
}

export function setNotifyEnabled(enabled: boolean): NotifyState {
  const state = { enabled }
  writeNotifyState(state)
  return state
}
