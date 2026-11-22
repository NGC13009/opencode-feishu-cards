/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { readNotifyState, setNotifyEnabled } from "./state"
import { VERSION } from "./version"

interface StatusStore {
  enabled: boolean
}

const TOAST_TITLE = "飞书通知"

export default Plugin.define({
  id: "feishu-notify.tui",
  setup(context) {
    const [status, updateStatus] = context.storage.memory<StatusStore>("status", {
      initial: { enabled: readNotifyState().enabled },
    })

    const showStatus = () => {
      context.ui.toast.show({
        title: TOAST_TITLE,
        message: status.enabled
          ? `当前已开启（v${VERSION}）。使用 /feishu off 关闭，或点击侧栏按钮切换。`
          : `当前已关闭（v${VERSION}）。使用 /feishu on 开启，或点击侧栏按钮切换。`,
        variant: status.enabled ? "success" : "warning",
      })
    }

    const apply = (enabled: boolean) => {
      try {
        setNotifyEnabled(enabled)
        updateStatus((draft) => {
          draft.enabled = enabled
        })
        context.ui.toast.show({
          title: TOAST_TITLE,
          message: enabled ? "已开启飞书通知。" : "已关闭飞书通知。",
          variant: enabled ? "success" : "warning",
        })
      } catch (error) {
        context.ui.toast.show({
          title: TOAST_TITLE,
          message: `写入通知状态失败：${error instanceof Error ? error.message : String(error)}`,
          variant: "error",
        })
      }
    }

    const toggle = () => apply(!status.enabled)

    const refresh = () => {
      const enabled = readNotifyState().enabled
      if (enabled !== status.enabled) {
        updateStatus((draft) => {
          draft.enabled = enabled
        })
      }
    }

    const timer = setInterval(refresh, 1000)

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "feishu.notify",
          title: "飞书通知",
          description: "查看或切换飞书通知状态：/feishu [on|off|toggle]",
          group: "飞书",
          palette: true,
          suggested: true,
          slash: { name: "feishu", aliases: ["fs"], arguments: true },
          run: async (input) => {
            refresh()
            const action = (input ?? "").trim().toLowerCase()
            if (action === "" || action === "status") {
              showStatus()
              return
            }
            if (action === "on" || action === "enable" || action === "开启") {
              apply(true)
              return
            }
            if (action === "off" || action === "disable" || action === "关闭") {
              apply(false)
              return
            }
            if (action === "toggle" || action === "切换") {
              toggle()
              return
            }
            context.ui.toast.show({
              title: TOAST_TITLE,
              message: `未知参数：${action}。用法：/feishu [on|off|toggle]`,
              variant: "warning",
            })
          },
        },
      ],
    }))

    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <box
          marginTop={1}
          paddingLeft={1}
          paddingRight={1}
          borderStyle="rounded"
          borderColor={status.enabled ? context.theme.border.base : context.theme.text.faint}
          backgroundColor={context.theme.background.raised.base}
          onMouseDown={(event) => {
            event.preventDefault()
            toggle()
          }}
        >
          <box flexDirection="column">
            <text fg={status.enabled ? context.theme.text.feedback.success.base : context.theme.text.faint}>
              {status.enabled ? "● 飞书通知：开" : "○ 飞书通知：关"}
            </text>
            <text fg={context.theme.text.faint}>点击切换 · /feishu</text>
          </box>
        </box>
      ),
    })

    return () => {
      clearInterval(timer)
      disposeSlot()
    }
  },
})
