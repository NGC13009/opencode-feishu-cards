import { homedir } from "node:os"
import { join } from "node:path"

export function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, "opencode") : join(homedir(), ".config", "opencode")
}
