import * as yaml from 'js-yaml'

import {
  getRecord,
  rebindNode,
  sameSource,
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
): ProxyChainItem[] => {
  // The proxy view refreshes on a fixed cadence; reusing item and array
  // identities while the rebound values are equal keeps persistence effects
  // and memoized chain rows from reprocessing identical content.
  let reboundItems: ProxyChainItem[] | undefined
  items.forEach((item, index) => {
    const rebound = rebindNode(candidates, {
      name: item.name,
      source: item.source,
    })
    const record =
      rebound === undefined ? undefined : getRecord(proxyView, rebound.recordId)
    const source = rebound?.source ?? item.source
    const type = rebound?.type ?? item.type
    const delay = record?.history.at(-1)?.delay
    const sourceReused =
      item.source === source ||
      (item.source !== undefined &&
        source !== undefined &&
        sameSource(item.source, source))

    if (
      item.recordId === rebound?.recordId &&
      sourceReused &&
      item.type === type &&
      item.delay === delay
    ) {
      return
    }

    reboundItems ??= [...items]
    reboundItems[index] = {
      ...item,
      recordId: rebound?.recordId,
      source,
      type,
      delay,
    }
  })
  return reboundItems ?? (items as ProxyChainItem[])
}

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
