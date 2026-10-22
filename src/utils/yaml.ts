import { load } from 'js-yaml'

import { debugLog } from './debug'

/**
 * 空文档返回 null，解析失败返回 undefined，且不抛出错误。
 */
export function parseYamlSafe(input: string) {
  if (
    input
      .split(/\r?\n/u)
      .every((line) => line.trim() === '' || line.trimStart().startsWith('#'))
  ) {
    return null
  }

  try {
    const parsedYaml = load(input)
    return parsedYaml ?? null
  } catch (e) {
    debugLog('parseYamlSafe failed', e)
    return undefined
  }
}
