import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../index"

interface CapturedMessage {
  receiveId: string
  msgType: string
  card: {
    schema: string
    header: { template: string; title: { content: string } }
    body: { elements: { tag: string; content: string }[] }
  }
}

function createEventStream() {
  const queue: unknown[] = []
  let waiting: ((result: IteratorResult<unknown>) => void) | null = null
  let closed = false

  return {
    push(event: unknown) {
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve({ value: event, done: false })
        return
      }
      queue.push(event)
    },
    close() {
      closed = true
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve({ value: undefined, done: true })
      }
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      while (true) {
        const next = queue.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        if (closed) return
        const result = await new Promise<IteratorResult<unknown>>((resolve) => {
          waiting = resolve
        })
        if (result.done) return
        yield result.value
      }
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("等待超时")
    await Bun.sleep(10)
  }
}

describe("插件端到端", () => {
  let server: ReturnType<typeof Bun.serve> | undefined
  let cleanup: (() => void | Promise<void>) | undefined
  let stream: ReturnType<typeof createEventStream> | undefined
  const stateFile = join(tmpdir(), `feishu-notify-e2e-${Date.now()}.json`)
  const eventConfigFile = join(tmpdir(), `feishu-notify-e2e-events-${Date.now()}.json`)

  afterEach(async () => {
    stream?.close()
    await cleanup?.()
    server?.stop(true)
    delete process.env.FEISHU_NOTIFY_STATE_PATH
    delete process.env.FEISHU_NOTIFY_CONFIG_PATH
    rmSync(stateFile, { force: true })
    rmSync(eventConfigFile, { force: true })
  })

  test("从 OpenCode 事件到飞书消息的完整链路", async () => {
    process.env.FEISHU_NOTIFY_STATE_PATH = stateFile
    process.env.FEISHU_NOTIFY_CONFIG_PATH = eventConfigFile
    const messages: CapturedMessage[] = []
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal/") {
          return Response.json({ code: 0, msg: "ok", tenant_access_token: "t-e2e", expire: 7200 })
        }
        if (url.pathname === "/open-apis/im/v1/messages") {
          const body = (await request.json()) as { receive_id: string; msg_type: string; content: string }
          messages.push({
            receiveId: body.receive_id,
            msgType: body.msg_type,
            card: JSON.parse(body.content),
          })
          return Response.json({ code: 0, msg: "ok", data: { message_id: "om_e2e" } })
        }
        return Response.json({ code: 404, msg: "not found" }, { status: 404 })
      },
    })

    stream = createEventStream()
    const ctx = {
      app: { version: "2.3.2" },
      location: {
        directory: "E:/project/demo",
        workspaceID: "ws1",
        project: { id: "proj_1", directory: "E:/project/demo", canonical: "E:/project/demo" },
      },
      options: {
        appId: "cli_e2e",
        appSecret: "secret_e2e",
        receiverId: "someone@example.com",
        receiverType: "email",
        baseUrl: `http://127.0.0.1:${server.port}`,
        summaryChars: 200,
      },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, title: "端到端测试" }),
        context: async () => [
          { type: "user", time: { created: Date.now() - 5000 } },
          { type: "assistant", content: [{ type: "text", text: "任务已经完成" }] },
        ],
      },
      tool: { hook: async () => {} },
      event: { subscribe: () => stream },
    }

    cleanup = await plugin.setup(ctx as unknown as Parameters<typeof plugin.setup>[0])
    stream.push({
      id: "evt_e2e_1",
      type: "session.execution.succeeded",
      location: { directory: "E:/project/demo", workspaceID: "ws1" },
      data: { sessionID: "ses_e2e" },
    })

    await waitFor(() => messages.length === 1)
    expect(messages[0].receiveId).toBe("someone@example.com")
    expect(messages[0].msgType).toBe("interactive")
    expect(messages[0].card.schema).toBe("2.0")
    expect(messages[0].card.header.title.content).toBe("[OpenCode] - 端到端测试 - 完成")
    expect(messages[0].card.body.elements[0].tag).toBe("markdown")
    expect(messages[0].card.body.elements[0].content).toContain("任务已经完成")
  })
})
