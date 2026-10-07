import { expect, it, vi } from 'vitest'

import { mutate } from './mutate'

vi.mock('@/services/notice-service', () => ({
  showNotice: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

it('executes every queued setting write even when its predecessor fails', async () => {
  let reject!: (error: Error) => void
  const first = mutate(
    () =>
      new Promise<void>((_resolve, rejectFirst) => {
        reject = rejectFirst
      }),
    { id: 'patch-verge-config', errorNotice: false },
  ).catch((error) => error)
  const writeSecond = vi.fn().mockResolvedValue(undefined)
  const onFulfilled = vi.fn()
  const second = mutate(writeSecond, {
    id: 'patch-verge-config',
    onFulfilled,
    errorNotice: false,
  })
  expect(writeSecond).not.toHaveBeenCalled()
  const error = new Error('first write failed')
  reject(error)
  expect(await first).toBe(error)
  expect(await second).toEqual({ ok: true, value: undefined })
  expect(writeSecond).toHaveBeenCalledOnce()
  expect(onFulfilled).toHaveBeenCalledOnce()
})
