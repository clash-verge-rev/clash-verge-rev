import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useServiceInstaller } from './use-service-installer'

const mocks = vi.hoisted(() => ({
  installService: vi.fn(),
  getRuntimeState: vi.fn(),
  restartCore: vi.fn(),
  setCacheDataAsync: vi.fn(),
  notice: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }))
vi.mock('@/services/cmds', () => mocks)
vi.mock('@/services/query-client', () => ({
  setCacheDataAsync: mocks.setCacheDataAsync,
}))
vi.mock('@/services/notice-service', () => ({ showNotice: mocks.notice }))
vi.mock('./use-system-state', () => ({ runStateQueryKey: ['getRuntimeState'] }))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('安装服务后的授权衔接', () => {
  it('等待系统批准时更新状态，不宣称成功或重启内核', async () => {
    const state = { service: 'approvalRequired' }
    mocks.getRuntimeState.mockResolvedValue(state)

    await useServiceInstaller().installServiceAndRestartCore()

    expect(mocks.installService).toHaveBeenCalledOnce()
    expect(mocks.setCacheDataAsync).toHaveBeenCalledWith(
      ['getRuntimeState'],
      state,
    )
    expect(mocks.restartCore).not.toHaveBeenCalled()
    expect(mocks.notice.success).not.toHaveBeenCalled()
  })

  it('服务就绪后仍按原流程重启内核', async () => {
    mocks.getRuntimeState.mockResolvedValue({ service: 'ready' })

    await useServiceInstaller().installServiceAndRestartCore()

    expect(mocks.restartCore).toHaveBeenCalledOnce()
    expect(mocks.notice.success).toHaveBeenCalledWith(
      'settings.feedback.notifications.clashService.installSuccess',
    )
  })

  it('安装失败时保留错误，不尝试启动内核', async () => {
    const failure = new Error('注册失败')
    mocks.installService.mockRejectedValue(failure)

    await expect(
      useServiceInstaller().installServiceAndRestartCore(),
    ).rejects.toThrow(failure)

    expect(mocks.notice.error).toHaveBeenCalledWith(failure)
    expect(mocks.restartCore).not.toHaveBeenCalled()
  })

  it('无法确认批准状态时提示错误，不宣称已安装成功', async () => {
    const failure = new Error('状态检查失败')
    mocks.getRuntimeState.mockRejectedValue(failure)

    await expect(
      useServiceInstaller().installServiceAndRestartCore(),
    ).rejects.toThrow(failure)

    expect(mocks.notice.error).toHaveBeenCalledWith(failure)
    expect(mocks.notice.success).not.toHaveBeenCalled()
    expect(mocks.restartCore).not.toHaveBeenCalled()
  })
})
