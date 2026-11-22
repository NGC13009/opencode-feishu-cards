import { afterEach, describe, expect, test } from "bun:test"
import { inferReceiverType, parseConfig } from "../config"

const base = {
  appId: "cli_test",
  appSecret: "secret_test",
  receiverId: "ou_test",
}

describe("inferReceiverType", () => {
  test("按常见前缀推断接收者类型", () => {
    expect(inferReceiverType("oc_123")).toBe("chat_id")
    expect(inferReceiverType("ou_123")).toBe("open_id")
    expect(inferReceiverType("on_123")).toBe("union_id")
    expect(inferReceiverType("someone@example.com")).toBe("email")
    expect(inferReceiverType("12345")).toBe("user_id")
  })
})

describe("parseConfig", () => {
  afterEach(() => {
    delete process.env.FEISHU_NOTIFY_TEST_SECRET
  })

  test("使用默认值并推断 receiverType", () => {
    const result = parseConfig(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.receiverType).toBe("open_id")
    expect(result.config.baseUrl).toBe("https://open.feishu.cn")
    expect(result.config.summaryChars).toBe(0)
  })

  test("缺少必填项时给出明确错误", () => {
    const result = parseConfig({ appId: "cli_test" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("appSecret")
    expect(result.error).toContain("receiverId")
  })

  test("支持环境变量占位符", () => {
    process.env.FEISHU_NOTIFY_TEST_SECRET = "from_env"
    const result = parseConfig({ ...base, appSecret: "${FEISHU_NOTIFY_TEST_SECRET}" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.appSecret).toBe("from_env")
  })

  test("环境变量未设置时拒绝启动", () => {
    const result = parseConfig({ ...base, appSecret: "${FEISHU_NOTIFY_TEST_MISSING}" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("FEISHU_NOTIFY_TEST_MISSING")
  })

  test("非法 receiverType 被拒绝", () => {
    const result = parseConfig({ ...base, receiverType: "phone" })
    expect(result.ok).toBe(false)
  })

  test("数值选项校验范围", () => {
    const negative = parseConfig({ ...base, minDurationSeconds: -1 })
    expect(negative.ok).toBe(false)
    const tooLarge = parseConfig({ ...base, summaryChars: 99999 })
    expect(tooLarge.ok).toBe(false)
  })

  test("自定义 baseUrl 会去掉末尾斜杠", () => {
    const result = parseConfig({ ...base, baseUrl: "https://open.larksuite.com/" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.baseUrl).toBe("https://open.larksuite.com")
  })
})
