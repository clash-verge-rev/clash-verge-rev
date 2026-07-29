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
  profileUid?: string
  type?: string
  delay?: number
}

export interface ProxyChainPayloadItem {
  name: string
  recordId?: string
  source?: ProxyNodeView['source']
  profileUid?: string
}

export const toProxyChainPayload = (
  items: readonly ProxyChainItem[],
): ProxyChainPayloadItem[] =>
  items.map(({ name, recordId, source, profileUid }) => ({
    name,
    recordId,
    source,
    profileUid,
  }))

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
