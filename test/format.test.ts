import { describe, expect, test } from "bun:test"
import {
  buildCompletionNotification,
  buildConnectedNotification,
  buildErrorNotification,
  buildInterruptedNotification,
  buildPermissionNotification,
  buildQuestionNotification,
  buildSessionStartedNotification,
  buildUserMessageNotification,
  extractAssistantSummary,
  formatDuration,
  lastUserMessageTime,
  truncate,
  truncateMarkdown,
} from "../format"

describe("formatDuration", () => {
  test("按秒、分、小时格式化", () => {
    expect(formatDuration(500)).toBe("不到 1 秒")
    expect(formatDuration(12_000)).toBe("12 秒")
    expect(formatDuration(61_000)).toBe("1 分 1 秒")
    expect(formatDuration(120_000)).toBe("2 分")
    expect(formatDuration(3_600_000)).toBe("1 小时")
    expect(formatDuration(3_900_000)).toBe("1 小时 5 分")
  })
})

describe("truncate", () => {
  test("超过上限时截断并加省略号", () => {
    expect(truncate("abcdef", 4)).toBe("abc…")
    expect(truncate("abc", 4)).toBe("abc")
    expect(truncate("abc", 0)).toBe("")
  })
})

describe("truncateMarkdown", () => {
  test("未超限时保持原样", () => {
    expect(truncateMarkdown("**abc**", 20)).toBe("**abc**")
  })

  test("截断时闭合未完成的围栏代码块", () => {
    const text = `前言\n\n\`\`\`json\n${"x".repeat(100)}\n\`\`\``
    const result = truncateMarkdown(text, 30)
    const fences = result.split("\n").filter((line) => line.trimStart().startsWith("```")).length
    expect(fences % 2).toBe(0)
    expect(result.endsWith("…")).toBe(true)
  })
})

describe("extractAssistantSummary", () => {
  test("取最后一条含正文的 assistant 消息", () => {
    const messages = [
      { type: "user", time: { created: 1000 } },
      { type: "assistant", content: [{ type: "text", text: "第一条" }] },
      { type: "assistant", content: [{ type: "tool", name: "read" }, { type: "text", text: "最终结果" }] },
    ]
    expect(extractAssistantSummary(messages, 100)).toBe("最终结果")
  })

  test("忽略没有正文的消息并截断", () => {
    const messages = [
      { type: "assistant", content: [{ type: "text", text: "旧结果" }] },
      { type: "assistant", content: [{ type: "tool", name: "read" }] },
    ]
    expect(extractAssistantSummary(messages, 2)).toBe("旧…")
  })

  test("没有正文时返回 null", () => {
    expect(extractAssistantSummary([{ type: "assistant", content: [] }], 100)).toBeNull()
  })

  test("上限为 0 时返回完整正文", () => {
    const text = "很长的结果".repeat(500)
    expect(extractAssistantSummary([{ type: "assistant", content: [{ type: "text", text }] }], 0)).toBe(text)
  })
})

describe("lastUserMessageTime", () => {
  test("取最后一条 user 消息时间", () => {
    const messages = [
      { type: "user", time: { created: 1000 } },
      { type: "assistant", time: { created: 2000 } },
      { type: "user", time: { created: 3000 } },
    ]
    expect(lastUserMessageTime(messages)).toBe(3000)
    expect(lastUserMessageTime([])).toBeNull()
  })
})

describe("通知内容", () => {
  test("完成通知把消息来源写在标题，正文只放内容", () => {
    const notification = buildCompletionNotification({
      sessionTitle: "修复登录",
      summary: "已修复并补充测试",
      subagent: false,
    })
    expect(notification.title).toBe("[OpenCode] - 修复登录 - 完成")
    expect(notification.color).toBe("green")
    expect(notification.body).toBe("已修复并补充测试")
  })

  test("没有摘要时正文为空", () => {
    const notification = buildCompletionNotification({
      sessionTitle: "子任务",
      summary: null,
      subagent: true,
    })
    expect(notification.title).toBe("[OpenCode] - 子任务 - 完成")
    expect(notification.body).toBe("")
  })

  test("错误、授权、询问通知携带关键信息", () => {
    const error = buildErrorNotification({
      sessionTitle: "会话",
      message: "模型超时",
      subagent: false,
    })
    expect(error.title).toBe("[OpenCode] - 会话 - 出错")
    expect(error.body).toBe("模型超时")

    const permission = buildPermissionNotification({
      sessionTitle: "会话",
      action: "shell",
      resources: ["git push *", "npm publish"],
    })
    expect(permission.title).toBe("[OpenCode] - 会话 - 授权")
    expect(permission.body).toContain("**操作**：shell")
    expect(permission.body).toContain("- git push *")

    const question = buildQuestionNotification({
      sessionTitle: null,
      title: "选择方案",
      fields: [{ key: "plan", title: "方案", options: [{ label: "A" }, { label: "B" }] }],
    })
    expect(question.title).toBe("[OpenCode] - 询问")
    expect(question.body).toBe("选择方案\n\n- 方案（A / B）")
  })

  test("用户消息只把用户文本放进正文", () => {
    const user = buildUserMessageNotification({ sessionTitle: "会话", text: "你好" })
    expect(user.title).toBe("[OpenCode] - 会话 - 用户")
    expect(user.body).toBe("你好")
  })

  test("纯状态事件没有正文", () => {
    const started = buildSessionStartedNotification({ sessionTitle: "会话" })
    expect(started.title).toBe("[OpenCode] - 会话 - 开始")
    expect(started.body).toBe("")

    const connected = buildConnectedNotification()
    expect(connected.title).toBe("[OpenCode] - 已连接")
    expect(connected.body).toBe("")

    const cancelled = buildInterruptedNotification({ sessionTitle: "会话", reason: "user", cancelled: true })
    expect(cancelled.title).toBe("[OpenCode] - 会话 - 取消")
    expect(cancelled.body).toBe("")

    const interrupted = buildInterruptedNotification({ sessionTitle: "会话", reason: "shutdown", cancelled: false })
    expect(interrupted.title).toBe("[OpenCode] - 会话 - 中断")
    expect(interrupted.body).toBe("原因：shutdown")
  })
})
