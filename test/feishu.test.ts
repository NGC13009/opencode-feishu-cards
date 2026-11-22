import { describe, expect, test } from "bun:test"
import { createFeishuClient, splitMarkdown } from "../feishu"

interface Call {
  url: string
  body: Record<string, unknown>
  authorization?: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function createMockFetch(handler: (url: URL, body: Record<string, unknown>, authorization?: string) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const headers = new Headers(init?.headers)
    const authorization = headers.get("Authorization") ?? undefined
    calls.push({ url: url.toString(), body, authorization })
    return handler(url, body, authorization)
  }) as typeof fetch
  return { fetchImpl, calls }
}

const baseOptions = {
  appId: "cli_test",
  appSecret: "secret_test",
  baseUrl: "https://open.feishu.cn",
}

describe("createFeishuClient", () => {
  test("缓存 token 并发送卡片消息", async () => {
    let tokenCalls = 0
    const mock = createMockFetch((url) => {
      if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal/") {
        tokenCalls += 1
        return jsonResponse({ code: 0, msg: "ok", tenant_access_token: "t-test", expire: 7200 })
      }
      return jsonResponse({ code: 0, msg: "ok", data: { message_id: "om_test" } })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl, now: () => 0 })
    const payload = {
      receiverId: "someone@example.com",
      receiverType: "email" as const,
      title: "✅ 任务完成",
      body: "项目：demo",
      color: "green" as const,
      uuid: "evt_123",
    }

    await client.sendNotification(payload)
    await client.sendNotification(payload)

    expect(tokenCalls).toBe(1)
    expect(mock.calls).toHaveLength(3)
    expect(mock.calls[1].url).toContain("receive_id_type=email")
    expect(mock.calls[1].authorization).toBe("Bearer t-test")
    expect(mock.calls[1].body.receive_id).toBe("someone@example.com")
    expect(mock.calls[1].body.msg_type).toBe("interactive")
    expect(mock.calls[1].body.uuid).toBe("evt_123")

    const card = JSON.parse(String(mock.calls[1].body.content)) as {
      schema: string
      header: { template: string; title: { content: string } }
      body: { elements: { tag: string; content: string }[] }
    }
    expect(card.schema).toBe("2.0")
    expect(card.header.template).toBe("green")
    expect(card.header.title.content).toBe("✅ 任务完成")
    expect(card.body.elements[0].tag).toBe("markdown")
    expect(card.body.elements[0].content).toBe("项目：demo")
  })

  test("没有正文时只发送标题栏", async () => {
    const mock = createMockFetch((url) => {
      if (url.pathname.endsWith("/tenant_access_token/internal/")) {
        return jsonResponse({ code: 0, tenant_access_token: "t", expire: 7200 })
      }
      return jsonResponse({ code: 0 })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl })
    await client.sendNotification({
      receiverId: "ou_x",
      receiverType: "open_id",
      title: "[OpenCode] - 会话 - 开始",
      body: "",
      color: "blue",
    })

    const send = mock.calls.find((call) => !call.url.includes("tenant_access_token"))
    const card = JSON.parse(String(send?.body.content)) as { header: { title: { content: string } }; body: { elements: unknown[] } }
    expect(card.header.title.content).toBe("[OpenCode] - 会话 - 开始")
    expect(card.body.elements).toEqual([])
  })

  test("token 过期后自动重新获取", async () => {
    let tokenCalls = 0
    let now = 0
    const mock = createMockFetch((url) => {
      if (url.pathname.endsWith("/tenant_access_token/internal/")) {
        tokenCalls += 1
        return jsonResponse({ code: 0, tenant_access_token: `t-${tokenCalls}`, expire: 7200 })
      }
      return jsonResponse({ code: 0 })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl, now: () => now })
    const payload = { receiverId: "ou_x", receiverType: "open_id" as const, title: "t", body: "b", color: "blue" as const }

    await client.sendNotification(payload)
    now = 7_200_000
    await client.sendNotification(payload)

    expect(tokenCalls).toBe(2)
    expect(mock.calls.at(-1)?.authorization).toBe("Bearer t-2")
  })

  test("token 失效时刷新并重试一次", async () => {
    let tokenCalls = 0
    let messageCalls = 0
    const mock = createMockFetch((url) => {
      if (url.pathname.endsWith("/tenant_access_token/internal/")) {
        tokenCalls += 1
        return jsonResponse({ code: 0, tenant_access_token: `t-${tokenCalls}`, expire: 7200 })
      }
      messageCalls += 1
      if (messageCalls === 1) return jsonResponse({ code: 99991663, msg: "invalid token" })
      return jsonResponse({ code: 0 })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl })
    await client.sendNotification({ receiverId: "ou_x", receiverType: "open_id", title: "t", body: "b", color: "blue" })

    expect(tokenCalls).toBe(2)
    expect(messageCalls).toBe(2)
    expect(mock.calls.at(-1)?.authorization).toBe("Bearer t-2")
  })

  test("飞书返回错误码时抛出可读异常", async () => {
    const mock = createMockFetch((url) => {
      if (url.pathname.endsWith("/tenant_access_token/internal/")) {
        return jsonResponse({ code: 0, tenant_access_token: "t", expire: 7200 })
      }
      return jsonResponse({ code: 230002, msg: "bot has no permission" })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl })
    await expect(client.sendNotification({
      receiverId: "ou_x",
      receiverType: "open_id",
      title: "t",
      body: "b",
      color: "blue",
    })).rejects.toThrow("230002")
  })

  test("获取 token 失败时给出清晰原因", async () => {
    const mock = createMockFetch(() => jsonResponse({ code: 10003, msg: "invalid app_secret" }))
    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl })
    await expect(client.sendNotification({
      receiverId: "ou_x",
      receiverType: "open_id",
      title: "t",
      body: "b",
      color: "blue",
    })).rejects.toThrow("invalid app_secret")
  })

  test("超长正文拆成多条卡片完整发送", async () => {
    const mock = createMockFetch((url) => {
      if (url.pathname.endsWith("/tenant_access_token/internal/")) {
        return jsonResponse({ code: 0, tenant_access_token: "t", expire: 7200 })
      }
      return jsonResponse({ code: 0 })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl })
    const body = Array.from({ length: 40 }, (_, index) => `${index}:${"x".repeat(200)}`).join("\n")
    await client.sendNotification({
      receiverId: "ou_x",
      receiverType: "open_id",
      title: "[OpenCode] - 长内容",
      body,
      color: "green",
      uuid: "evt_long",
    })

    const sends = mock.calls.filter((call) => !call.url.includes("tenant_access_token"))
    expect(sends.length).toBeGreaterThan(1)

    const received: string[] = []
    sends.forEach((call, index) => {
      const card = JSON.parse(String(call.body.content)) as { header: { title: { content: string } }; body: { elements: { content: string }[] } }
      expect(card.header.title.content).toBe(`[OpenCode] - 长内容（${index + 1}/${sends.length}）`)
      expect(card.body.elements[0].content.length).toBeLessThanOrEqual(3_500)
      received.push(card.body.elements[0].content)
    })

    expect(received.join("\n")).toBe(body)
    // 每段使用不同幂等键，避免后续分段被飞书当作重复消息丢弃。
    expect(new Set(sends.map((call) => call.body.uuid)).size).toBe(sends.length)
  })

  test("幂等键过长时也保证每段唯一", async () => {
    const mock = createMockFetch((url) => {
      if (url.pathname.endsWith("/tenant_access_token/internal/")) {
        return jsonResponse({ code: 0, tenant_access_token: "t", expire: 7200 })
      }
      return jsonResponse({ code: 0 })
    })

    const client = createFeishuClient({ ...baseOptions, fetchImpl: mock.fetchImpl })
    const body = "y".repeat(10_000)
    await client.sendNotification({
      receiverId: "ou_x",
      receiverType: "open_id",
      title: "t",
      body,
      color: "blue",
      uuid: "00000000000000000000000000000000000000000000000000",
    })

    const sends = mock.calls.filter((call) => !call.url.includes("tenant_access_token"))
    expect(sends.length).toBeGreaterThan(1)
    const uuids = sends.map((call) => String(call.body.uuid))
    expect(new Set(uuids).size).toBe(uuids.length)
    expect(uuids.every((uuid) => uuid.length <= 50)).toBe(true)
  })
})

describe("splitMarkdown", () => {
  test("未超限时原样返回", () => {
    expect(splitMarkdown("**abc**", 100)).toEqual(["**abc**"])
    expect(splitMarkdown("abc", 0)).toEqual(["abc"])
  })

  test("按行拆分且不丢内容", () => {
    const body = Array.from({ length: 20 }, (_, index) => `第 ${index} 行 ${"x".repeat(30)}`).join("\n")
    const parts = splitMarkdown(body, 120)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.length <= 120)).toBe(true)
    expect(parts.join("\n")).toBe(body)
  })

  test("拆分代码块时补全围栏", () => {
    const body = `\`\`\`ts\n${Array.from({ length: 100 }, (_, index) => `const v${index} = ${index}`).join("\n")}\n\`\`\``
    const parts = splitMarkdown(body, 200)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      const fences = part.split("\n").filter((line) => /^\s*```/.test(line)).length
      expect(fences % 2).toBe(0)
    }
    expect(parts.slice(1).every((part) => part.startsWith("```ts\n"))).toBe(true)
  })

  test("超长单行也会被切开", () => {
    const body = "z".repeat(1_000)
    const parts = splitMarkdown(body, 300)
    expect(parts.length).toBe(4)
    expect(parts.join("")).toBe(body)
  })
})
