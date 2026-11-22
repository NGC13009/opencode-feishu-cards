import { parseConfig } from "./config"
import { createFeishuClient } from "./feishu"
import { buildCompletionNotification } from "./format"

const parsed = parseConfig({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  receiverId: process.env.FEISHU_RECEIVER_ID,
  receiverType: process.env.FEISHU_RECEIVER_TYPE,
  baseUrl: process.env.FEISHU_BASE_URL,
})

if (!parsed.ok) {
  console.error(`配置无效：${parsed.error}`)
  process.exit(1)
}

const config = parsed.config
const client = createFeishuClient({
  appId: config.appId,
  appSecret: config.appSecret,
  baseUrl: config.baseUrl,
})

const notification = buildCompletionNotification({
  sessionTitle: "飞书通知测试",
  summary: [
    "**Markdown 渲染测试**",
    "",
    "- 列表项",
    "- 行内 `code`",
    "- **粗体**",
    "",
    "```json",
    '{"status": "ok"}',
    "```",
    "",
    `测试时间：${new Date().toLocaleString("zh-CN")}`,
  ].join("\n"),
  subagent: false,
})

try {
  await client.sendNotification({
    ...notification,
    receiverId: config.receiverId,
    receiverType: config.receiverType,
    uuid: `feishu-notify-test-${Date.now()}`,
  })
  console.log("测试消息已发送，请到飞书查收。")
} catch (error) {
  console.error("发送失败：", error instanceof Error ? error.message : error)
  process.exit(1)
}
