import delayManager from '@/services/delay'
import { memberDetails } from '@/types/proxy-view'
import { compileStringMatcher } from '@/utils/search-matcher'

import type { ResolvedMemberOccurrence } from './use-render-list'

// default | delay | alphabet
export type ProxySortType = 0 | 1 | 2

export type ProxySearchState = {
  matchCase?: boolean
  matchWholeWord?: boolean
  useRegularExpression?: boolean
}

export function filterSort(
  proxies: ResolvedMemberOccurrence[],
  groupName: string,
  filterText: string,
  sortType: ProxySortType,
  latencyTimeout?: number,
  searchState?: ProxySearchState,
) {
  const fp = filterProxies(proxies, groupName, filterText, searchState)
  const sp = sortProxies(fp, groupName, sortType, latencyTimeout)
  return sp
}

/**
 * 可以通过延迟数/节点类型 过滤
 */
const regex1 = /delay([=<>])(\d+|timeout|error)/i
const regex2 = /type=(.*)/i

/**
 * filter the proxy
 * according to the regular conditions
 */
function filterProxies(
  proxies: ResolvedMemberOccurrence[],
  groupName: string,
  filterText: string,
  searchState?: ProxySearchState,
) {
  const query = filterText.trim()
  if (!query) return proxies

  const res1 = regex1.exec(query)
  if (res1) {
    const symbol = res1[1]
    const symbol2 = res1[2].toLowerCase()
    const value =
      symbol2 === 'error' ? 1e5 : symbol2 === 'timeout' ? 3000 : +symbol2

    return proxies.filter(({ member }) => {
      const delay = delayManager.getDelayFix(member, groupName)

      if (delay < 0) return false
      if (symbol === '=' && symbol2 === 'error') return delay >= 1e5
      if (symbol === '=' && symbol2 === 'timeout')
        return delay < 1e5 && delay >= 3000
      if (symbol === '=') return delay == value
      if (symbol === '<') return delay <= value
      if (symbol === '>') return delay >= value
      return false
    })
  }

  const res2 = regex2.exec(query)
  if (res2) {
    const type = res2[1].toLowerCase()
    return proxies.filter(({ member }) =>
      (memberDetails(member)?.type ?? '').toLowerCase().includes(type),
    )
  }

  const {
    matchCase = false,
    matchWholeWord = false,
    useRegularExpression = false,
  } = searchState ?? {}
  const compiled = compileStringMatcher(query, {
    matchCase,
    matchWholeWord,
    useRegularExpression,
  })

  if (!compiled.isValid) return []
  return proxies.filter(({ member }) => compiled.matcher(member.ref.name))
}

/**
 * sort the proxy
 */
function sortProxies(
  proxies: ResolvedMemberOccurrence[],
  groupName: string,
  sortType: ProxySortType,
  latencyTimeout?: number,
) {
  if (!proxies) return []
  if (sortType === 0) return proxies

  const list = proxies.slice()
  const effectiveTimeout =
    typeof latencyTimeout === 'number' && latencyTimeout > 0
      ? latencyTimeout
      : 10000

  if (sortType === 1) {
    const categorizeDelay = (delay: number): [number, number] => {
      if (!Number.isFinite(delay)) return [3, Number.MAX_SAFE_INTEGER]
      if (delay > 1e5) return [4, delay]
      if (delay === 0 || (delay >= effectiveTimeout && delay <= 1e5)) {
        return [3, delay || effectiveTimeout]
      }
      if (delay < 0) {
        // sentinel delays (-1, -2, etc.) should always sort after real measurements
        return [5, Number.MAX_SAFE_INTEGER]
      }
      return [0, delay]
    }

    list.sort((a, b) => {
      const ad = delayManager.getDelayFix(a.member, groupName)
      const bd = delayManager.getDelayFix(b.member, groupName)
      const [ar, av] = categorizeDelay(ad)
      const [br, bv] = categorizeDelay(bd)

      if (ar !== br) return ar - br
      return av - bv
    })
  } else {
    list.sort((a, b) => a.member.ref.name.localeCompare(b.member.ref.name))
  }

  return list
}
