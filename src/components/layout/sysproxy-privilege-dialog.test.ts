import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SysproxyPrivilegeDialog } from './sysproxy-privilege-dialog'

const mocks = vi.hoisted(() => ({
  state: {
    service: 'approvalRequired',
    serviceUsable: false,
    sidecarAllowed: false,
    mode: 'Sidecar',
  },
  onOk: () => {},
  getRuntimeState: vi.fn(),
  installService: vi.fn(),
  openServiceSettings: vi.fn(),
  restartCore: vi.fn(),
  patchVergeConfig: vi.fn(),
  clearServiceRequest: vi.fn(),
  mutateSystemState: vi.fn(),
  dismiss: vi.fn(),
  notice: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
    getSnapshot(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@mui/material', () => ({
  Alert: () => null,
  LinearProgress: () => null,
  Typography: () => null,
}))
vi.mock('@/components/base', () => ({
  BaseDialog: ({ onOk }: { onOk: () => void }) => {
    mocks.onOk = onOk
    return null
  },
}))
vi.mock('@/hooks/use-system-state', () => ({
  useSystemState: () => ({
    runState: mocks.state,
    mutateSystemState: mocks.mutateSystemState,
  }),
}))
vi.mock('@/services/cmds', () => mocks)
vi.mock('@/services/notice-service', () => ({ showNotice: mocks.notice }))
vi.mock('@/services/service-request', () => ({
  getServiceRequest: () => ({
    reason: 'tunNeedsService',
    restore: { enable_tun_mode: true },
  }),
  subscribeServiceRequest: vi.fn(),
  clearServiceRequest: mocks.clearServiceRequest,
}))

// 渲染真实组件取得按钮回调，只替换 UI 外壳和系统边界，不执行本机代理操作。
const clickPrimary = async () => {
  renderToStaticMarkup(
    createElement(SysproxyPrivilegeDialog, {
      failure: null,
      dismiss: mocks.dismiss,
    }),
  )
  mocks.onOk()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state = {
    service: 'approvalRequired',
    serviceUsable: false,
    sidecarAllowed: false,
    mode: 'Sidecar',
  }
  mocks.getRuntimeState.mockImplementation(() => Promise.resolve(mocks.state))
})

describe('TUN 请求跨越系统批准流程', () => {
  it('等待批准时打开系统设置并保留原 TUN 请求', async () => {
    await clickPrimary()

    expect(mocks.openServiceSettings).toHaveBeenCalledOnce()
    expect(mocks.installService).not.toHaveBeenCalled()
    expect(mocks.restartCore).not.toHaveBeenCalled()
    expect(mocks.patchVergeConfig).not.toHaveBeenCalled()
    expect(mocks.clearServiceRequest).not.toHaveBeenCalled()
  })

  it('批准后继续启动服务内核并恢复 TUN，不重复安装', async () => {
    mocks.state = {
      service: 'ready',
      serviceUsable: true,
      sidecarAllowed: false,
      mode: 'Sidecar',
    }
    mocks.restartCore.mockImplementation(() => {
      mocks.state.mode = 'Service'
    })

    await clickPrimary()

    expect(mocks.installService).not.toHaveBeenCalled()
    expect(mocks.restartCore).toHaveBeenCalledOnce()
    expect(mocks.patchVergeConfig).toHaveBeenCalledWith({
      enable_tun_mode: true,
    })
    expect(mocks.clearServiceRequest).toHaveBeenCalledOnce()
  })

  it('新注册仍需批准时不提前重启或写入 TUN 设置', async () => {
    mocks.state.service = 'notInstalled'
    mocks.installService.mockImplementation(() => {
      mocks.state.service = 'approvalRequired'
    })

    await clickPrimary()

    expect(mocks.installService).toHaveBeenCalledOnce()
    expect(mocks.restartCore).not.toHaveBeenCalled()
    expect(mocks.patchVergeConfig).not.toHaveBeenCalled()
    expect(mocks.clearServiceRequest).not.toHaveBeenCalled()
  })

  it('批准后内核启动失败时保留请求以便重试', async () => {
    mocks.state = {
      service: 'ready',
      serviceUsable: true,
      sidecarAllowed: false,
      mode: 'Sidecar',
    }
    mocks.restartCore.mockRejectedValue(new Error('内核启动失败'))

    await clickPrimary()

    expect(mocks.notice.error).toHaveBeenCalledOnce()
    expect(mocks.patchVergeConfig).not.toHaveBeenCalled()
    expect(mocks.clearServiceRequest).not.toHaveBeenCalled()
  })
})
