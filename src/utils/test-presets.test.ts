import { expect, test } from 'vitest'

import { applyTestPresetSelection, isTestPresetEnabled } from './test-presets'

const github = {
  uid: 'builtin-github',
  name: 'GitHub',
  url: 'https://github.com',
  icon: '',
}

test('recognizes a saved default without replacing its name, icon or position', () => {
  const list = [
    { uid: 'custom', name: 'Work', url: 'https://example.com/status' },
    {
      uid: 'old-random-id',
      name: 'My GitHub',
      url: 'https://www.github.com/',
      icon: '<svg>custom</svg>',
    },
    { uid: 'custom-last', name: 'Last', url: 'https://example.org' },
  ]
  expect(isTestPresetEnabled(list, github)).toBe(true)
  expect(applyTestPresetSelection(list, ['builtin-github'])).toEqual(list)
  expect(list[1].uid).toBe('old-random-id')
})

test('adds a preset once and only removes matching website addresses', () => {
  const custom = { uid: 'work', name: 'GitHub', url: 'https://example.com' }
  const list = [custom]
  const enabled = applyTestPresetSelection(list, ['builtin-github'])
  expect(enabled).toMatchObject([
    custom,
    { name: 'GitHub', url: 'https://www.github.com' },
  ])
  expect(applyTestPresetSelection(enabled, ['builtin-github'])).toHaveLength(2)
  expect(applyTestPresetSelection(enabled, [])).toEqual([custom])
  expect(list).toEqual([custom])
})

test('uses a new identifier when an edited default keeps the old preset identifier', () => {
  const custom = { ...github, url: 'https://example.com' }
  const list = applyTestPresetSelection([custom], ['builtin-github'])
  expect(list).toHaveLength(2)
  expect(list[0]).toEqual(custom)
  expect(list[1].uid).not.toBe(custom.uid)
})

test('keeps custom paths and invalid custom addresses when disabling a preset', () => {
  const list = [
    github,
    { uid: 'repository', url: 'https://github.com/Aurenthic/clash-verge-rev' },
    { uid: 'invalid', url: 'my-custom-address' },
    { uid: 'empty', url: null },
  ]
  expect(applyTestPresetSelection(list, [])).toEqual(list.slice(1))
  expect(isTestPresetEnabled(list.slice(1), github)).toBe(false)
})
