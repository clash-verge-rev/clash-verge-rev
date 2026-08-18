import { describe, expect, test } from 'vitest'

import { hasRenderableItems, type IRenderItem } from './use-render-list'

const group = (hidden = false) =>
  ({ name: 'Proxies', hidden }) as unknown as IRenderItem['group']

const header = (hidden = false): IRenderItem => ({
  type: 0,
  key: 'header',
  group: group(hidden),
})

const member = (key: string): IRenderItem => ({
  type: 2,
  key,
  group: group(),
})

const memberColumn = (key: string): IRenderItem => ({
  type: 4,
  key,
  group: group(),
})

describe('hasRenderableItems', () => {
  test('an empty list has nothing to show', () => {
    expect(hasRenderableItems([])).toBe(false)
  })

  test('chain mode is answered by the chain list itself', () => {
    // Rendered rows, not group types, determine whether chain mode is empty.
    expect(hasRenderableItems([member('chain:a')])).toBe(true)
    expect(hasRenderableItems([memberColumn('chain-col:a')])).toBe(true)
  })

  test('a visible group counts even before it is expanded', () => {
    expect(hasRenderableItems([header()])).toBe(true)
  })

  test('hidden groups alone are not content', () => {
    expect(hasRenderableItems([header(true), header(true)])).toBe(false)
  })

  test('one visible group among hidden ones is enough', () => {
    expect(hasRenderableItems([header(true), header(), header(true)])).toBe(
      true,
    )
  })

  test('rows inside a hidden but expanded group are still rows on screen', () => {
    // Visible member rows mean the page is not empty even without a visible group header.
    expect(hasRenderableItems([header(true), member('member:a')])).toBe(true)
  })
})
