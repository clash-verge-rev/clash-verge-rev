import { describe, expect, test } from 'vitest'

import { hasRenderableItems, type IRenderItem } from './use-render-list'

const group = (hidden = false) =>
  ({ name: 'Proxies', hidden }) as unknown as IRenderItem['group']

/** A group header row. On its own it is only content when the group is visible. */
const header = (hidden = false): IRenderItem => ({
  type: 0,
  key: 'header',
  group: group(hidden),
})

/** A member row — in chain mode the list is made entirely of these. */
const member = (key: string): IRenderItem => ({
  type: 2,
  key,
  group: group(),
})

/** A column of members, which is how the chain list renders at column counts above one. */
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
    // This is the case the old prediction got wrong in both directions: it asked whether any
    // Selector or URLTest group existed, which is unrelated to what the chain list is built
    // from. Here there are rows, so there is content, whatever groups happen to exist.
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
    // Truthfulness over tidiness: the user can see these, so calling the page empty would be
    // a lie. The old predicate said "empty" here.
    expect(hasRenderableItems([header(true), member('member:a')])).toBe(true)
  })
})
