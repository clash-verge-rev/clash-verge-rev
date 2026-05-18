import { useEffect, useState } from 'react'

/**
 * 检测页面可见性状态
 *
 * 用途:
 * - 当标签页在后台时暂停更新
 * - 当标签页返回前台时恢复更新
 * - 节省网络流量和 CPU 资源
 */
export const usePageVisibility = (onVisibilityChange?: (isVisible: boolean) => void) => {
  const [isVisible, setIsVisible] = useState(() => {
    // SSR 兼容性检查
    if (typeof document === 'undefined') return true
    return !document.hidden
  })

  useEffect(() => {
    const handleVisibilityChange = () => {
      const nowVisible = !document.hidden
      setIsVisible(nowVisible)
      onVisibilityChange?.(nowVisible)

      if (nowVisible) {
        console.debug('[PageVisibility] Tab is visible, resuming updates')
      } else {
        console.debug('[PageVisibility] Tab is hidden, pausing updates')
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [onVisibilityChange])

  return isVisible
}

/**
 * 应用级页面可见性状态存储
 *
 * 允许多个组件共享同一个可见性状态而不需要多个事件监听器
 */
let globalVisibilityState = typeof document !== 'undefined' ? !document.hidden : true
const visibilityListeners = new Set<(isVisible: boolean) => void>()

const initGlobalVisibilityTracking = () => {
  if (typeof document === 'undefined') return

  const handleVisibilityChange = () => {
    globalVisibilityState = !document.hidden
    visibilityListeners.forEach((listener) => listener(globalVisibilityState))
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
}

// 触发初始化（只执行一次）
if (typeof document !== 'undefined') {
  initGlobalVisibilityTracking()
}

/**
 * 获取全局页面可见性状态（不订阅更新）
 *
 * 用途: 在异步操作中快速检查当前可见性
 */
export const isPageVisible = (): boolean => {
  if (typeof document === 'undefined') return true
  return !document.hidden
}

/**
 * 订阅全局页面可见性变化
 *
 * 返回取消订阅函数
 */
export const subscribeToPageVisibility = (
  listener: (isVisible: boolean) => void,
): (() => void) => {
  visibilityListeners.add(listener)
  return () => {
    visibilityListeners.delete(listener)
  }
}
