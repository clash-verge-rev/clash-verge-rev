import { load, LoadOptions } from 'js-yaml'

/**
 * 解析失败返回null, 不抛出错误
 */
export function parseYamlSafe(input: string, options?: LoadOptions) {
  try {
    const rs = load(input, options)
    return rs ?? null
  } catch (ignore) {
    return null
  }
}
