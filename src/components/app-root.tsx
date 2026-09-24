import { useEffect, type ReactNode } from 'react'

import { hideInitialOverlay } from '@/utils/initial-loading-overlay'

/**
 * 根组件：React 树挂载完成后掀开 index.html 的启动遮罩。
 * 遮罩的使命是遮盖「HTML 已加载、React 未就绪」的窗口期，
 * 树挂载（无论树内渲染主界面还是其他顶层形态）即使命结束。
 */
export function AppRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    hideInitialOverlay()
  }, [])
  return <>{children}</>
}
