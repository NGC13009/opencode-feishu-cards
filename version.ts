import pkg from "./package.json"

/**
 * 插件版本，单一真相源为 package.json 的 version 字段。
 * 发版时只改 package.json，这里不要写死版本号。
 */
export const VERSION: string = pkg.version
