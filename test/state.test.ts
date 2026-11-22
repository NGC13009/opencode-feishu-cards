import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readNotifyState, setNotifyEnabled, statePath, writeNotifyState } from "../state"

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "feishu-notify-state-"))
  process.env.FEISHU_NOTIFY_STATE_PATH = join(directory, "state.json")
})

afterEach(() => {
  delete process.env.FEISHU_NOTIFY_STATE_PATH
  rmSync(directory, { recursive: true, force: true })
})

describe("通知状态", () => {
  test("默认开启", () => {
    expect(statePath()).toBe(join(directory, "state.json"))
    expect(readNotifyState()).toEqual({ enabled: true })
  })

  test("写入后可以读回", () => {
    setNotifyEnabled(false)
    expect(readNotifyState()).toEqual({ enabled: false })
    expect(JSON.parse(readFileSync(statePath(), "utf8"))).toEqual({ enabled: false })

    writeNotifyState({ enabled: true })
    expect(readNotifyState()).toEqual({ enabled: true })
  })

  test("文件损坏时按默认开启处理", () => {
    writeFileSync(statePath(), "{not json", "utf8")
    expect(readNotifyState()).toEqual({ enabled: true })
  })
})
