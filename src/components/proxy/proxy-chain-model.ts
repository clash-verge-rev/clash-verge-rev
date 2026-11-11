import * as yaml from 'js-yaml'

import {
  getRecord,
  rebindNode,
  type ProxyNodeView,
  type ProxyViewV1,
} from '@/types/proxy-view'

export interface ProxyChainItem {
  id: string
  name: string
  recordId?: string
  source?: ProxyNodeView['source']
  type?: string
  delay?: number
}

export const rebindProxyChainItems = (
  items: readonly ProxyChainItem[],
  candidates: readonly ProxyNodeView[],
  proxyView: ProxyViewV1,
): ProxyChainItem[] =>
  items.map((item) => {
    const rebound = rebindNode(candidates, {
      name: item.name,
      source: item.source,
    })
    const record =
      rebound === undefined ? undefined : getRecord(proxyView, rebound.recordId)
    return {
      ...item,
      recordId: rebound?.recordId,
      source: rebound?.source ?? item.source,
      type: rebound?.type ?? item.type,
      delay: record?.history.at(-1)?.delay,
    }
  })

interface ParsedChainConfig {
  proxies?: Array<{
    name: string
    type: string
    [key: string]: any
  }>
}

export const parseChainConfigItems = (configData: string): ProxyChainItem[] => {
  try {
    // JSON is valid YAML, so one parser covers both persisted formats.
    const parsedConfig = yaml.load(configData) as ParsedChainConfig | null
    const timestamp = Date.now()

    return (
      parsedConfig?.proxies?.map((proxy, index) => ({
        id: `${proxy.name}_${timestamp}_${index}`,
        name: proxy.name,
        type: proxy.type,
        delay: undefined,
      })) || []
    )
  } catch (error) {
    console.error('Failed to process chain config data:', error)
    return []
  }
}
