// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { setPreloadConfig } from '@/services/preload'

import { useUpdate } from './use-update'

const check = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-updater', () => ({ check }))

beforeEach(() => {
  localStorage.clear()
  setPreloadConfig({ auto_check_update: false } as IVergeConfig)
  check.mockReset()
})

test('manual update check works when automatic checks are disabled', async () => {
  const availableUpdate = { version: '9.9.9' }
  check.mockResolvedValueOnce(availableUpdate)
  const { result } = renderHook(() => useUpdate())

  let checked
  await act(async () => {
    checked = await result.current.checkUpdate()
  })

  expect(check).toHaveBeenCalledOnce()
  expect(checked).toEqual({ data: availableUpdate })
  await waitFor(() => expect(result.current.lastCheckUpdate).not.toBeNull())
})
