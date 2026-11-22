import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_EVENT_RULES, eventRulesPath, readEventRules } from "../events"

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "feishu-notify-events-"))
  process.env.FEISHU_NOTIFY_CONFIG_PATH = join(directory, "feishu-notify.json")
})

afterEach(() => {
  delete process.env.FEISHU_NOTIFY_CONFIG_PATH
  rmSync(directory, { recursive: true, force: true })
})

function writeConfig(value: unknown): void {
  writeFileSync(eventRulesPath(), JSON.stringify(value), "utf8")
}

describe("事件配置", () => {
  test("文件不存在时使用默认规则", () => {
    expect(eventRulesPath()).toBe(join(directory, "feishu-notify.json"))
    expect(readEventRules()).toEqual({ rules: DEFAULT_EVENT_RULES, path: eventRulesPath() })
  })

  test("支持布尔值和 notification 对象", () => {
    writeConfig({
      events: {
        complete: { notification: false },
        error: true,
        question: { notification: true },
      },
    })

    const result = readEventRules()
    expect(result.error).toBeUndefined()
    expect(result.rules.complete).toBe(false)
    expect(result.rules.error).toBe(true)
    expect(result.rules.question).toBe(true)
    expect(result.rules.permission).toBe(DEFAULT_EVENT_RULES.permission)
  })

  test("支持顶层事件键，便于复用 tray 配置结构", () => {
    writeConfig({ complete: false, permission: { notification: false } })
    const result = readEventRules()
    expect(result.rules.complete).toBe(false)
    expect(result.rules.permission).toBe(false)
  })

  test("非法 JSON 返回默认规则并给出错误", () => {
    writeFileSync(eventRulesPath(), "{not json", "utf8")
    const result = readEventRules()
    expect(result.rules).toEqual(DEFAULT_EVENT_RULES)
    expect(result.error).toBeTruthy()
  })
})
