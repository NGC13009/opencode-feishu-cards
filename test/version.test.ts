import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import pkg from "../package.json"
import { VERSION } from "../version"

const root = join(import.meta.dir, "..")
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
  version: string
  packages: Record<string, { version?: string }>
}
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")

/** 版本号的单一真相源是 package.json；runtime、锁文件与文档都必须跟随它，而不是各自写死。 */
describe("插件版本", () => {
  test("VERSION 与 package.json 保持一致", () => {
    expect(VERSION).toBe(pkg.version)
  })

  test("VERSION 是合法 SemVer", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  })

  test("package-lock.json 与 package.json 版本一致", () => {
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[""]?.version).toBe(pkg.version)
  })

  test("CHANGELOG.md 包含当前版本的小节", () => {
    expect(changelog).toContain(`## ${VERSION}`)
  })
})
