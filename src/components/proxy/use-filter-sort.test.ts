import { afterEach, expect, test, vi } from 'vitest'

import delayManager from '@/services/delay'
import { compareByDelay } from '@/utils/delay'

import { filterSort } from './use-filter-sort'
import type { ResolvedMemberOccurrence } from './use-render-list'

const node = (memberIndex: number, delay: number, name = `${memberIndex}`) =>
  ({
    memberIndex,
    member: {
      kind: 'node',
      ref: { kind: 'node', name, recordId: `${memberIndex}` },
      node: {
        history: [{ delay }],
        source: { kind: 'provider', providerName: `${memberIndex}` },
      },
    },
  }) as ResolvedMemberOccurrence

afterEach(() => vi.restoreAllMocks())

test('matches the previous comparator for cached, fallback and sentinel delays', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  const values = [30, 0, -2, -1, 1e6, 10000, 30, NaN, Infinity]
  const list = values.map((delay, i) => node(i, delay))
  list.push(node(10, 50, 'same'), node(11, 5, 'same'), list[0])
  list.push({
    memberIndex: 12,
    member: {
      kind: 'unresolved',
      ref: { kind: 'unresolved', name: 'missing', reason: 'missing' },
    },
  })
  for (const cached of [false, true]) {
    const group = `sort-${cached}`
    if (cached) {
      values.forEach((delay, i) => delayManager.setDelay(`${i}`, group, delay))
    }
    for (const timeout of [10000, 20, 0, NaN]) {
      const expected = list
        .slice()
        .sort((a, b) =>
          compareByDelay(
            delayManager.getDelayFix(a.member, group),
            delayManager.getDelayFix(b.member, group),
            timeout > 0 ? timeout : 10000,
          ),
        )
      const before = list.slice()
      const result = filterSort(list, group, '', 1, timeout)
      expect(result).toEqual(expected)
      result.forEach((item, i) => expect(item).toBe(expected[i]))
      expect(list).toEqual(before)
    }
  }
})

test('reads each occurrence once and observes cache updates and expiry on the next call', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const list = [
    node(0, 50),
    node(1, 15, 'same'),
    node(2, 5, 'same'),
    node(3, 25),
  ]
  const cachedOrder = [list[0], list[2], list[1], list[3]]
  delayManager.setDelay('0', 'expiry', 1)
  const get = vi.spyOn(delayManager, 'getDelayFix')
  expect(filterSort(list, 'expiry', '', 1)).toEqual(cachedOrder)
  expect(get).toHaveBeenCalledTimes(list.length)
  list.forEach((item, i) => expect(get.mock.calls[i][0]).toBe(item.member))
  clock.mockReturnValue(1000 + 30 * 60 * 1000)
  expect(filterSort(list, 'expiry', '', 1)).toEqual(cachedOrder)
  clock.mockReturnValue(1001 + 30 * 60 * 1000)
  expect(filterSort(list, 'expiry', '', 1)).toEqual([
    list[2],
    list[1],
    list[3],
    list[0],
  ])
  delayManager.setDelay('0', 'expiry', 2)
  expect(filterSort(list, 'expiry', '', 1)).toEqual(cachedOrder)
  get.mockClear()
  filterSort([], 'expiry', '', 1)
  filterSort([list[0]], 'expiry', '', 1)
  expect(filterSort(list, 'expiry', '', 0)).toBe(list)
  filterSort(list, 'expiry', '', 2)
  expect(get).not.toHaveBeenCalled()
})
