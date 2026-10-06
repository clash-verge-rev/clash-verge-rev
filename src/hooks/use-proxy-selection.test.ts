import { selectNodeForGroup } from 'tauri-plugin-mihomo-api'
import { expect, it, vi } from 'vitest'

import { useProxySelection } from './use-proxy-selection'

const record = vi.hoisted(() => vi.fn())
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}))
vi.mock('@/hooks/use-record-selection', () => ({
  useRecordSelection: () => record,
  useForgetSelection: () => vi.fn(),
}))
vi.mock('@/hooks/use-verge', () => ({ useVerge: () => ({ verge: {} }) }))
vi.mock('tauri-plugin-mihomo-api', () => ({
  selectNodeForGroup: vi.fn(),
  unfixedProxy: vi.fn(),
}))
vi.mock('@/services/cmds', () => ({ syncTrayProxySelection: vi.fn() }))
vi.mock('@/services/notice-service', () => ({ showNotice: { error: vi.fn() } }))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

it('applies and records independent group selections while another group is pending', async () => {
  let finishFirst!: () => void
  vi.mocked(selectNodeForGroup)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        }),
    )
    .mockResolvedValueOnce(undefined)
  const firstSuccess = vi.fn()
  const secondSuccess = vi.fn()
  const first = useProxySelection({ onSuccess: firstSuccess })
  const second = useProxySelection({ onSuccess: secondSuccess })
  first.changeProxy('Group A', 'Node A')
  second.changeProxy('Group B', 'Node B')
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith('Group B', 'Node B'),
  )
  expect(selectNodeForGroup).toHaveBeenCalledTimes(2)
  expect(firstSuccess).not.toHaveBeenCalled()
  expect(secondSuccess).toHaveBeenCalledOnce()
  finishFirst()
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith('Group A', 'Node A'),
  )
  expect(firstSuccess).toHaveBeenCalledOnce()
})
