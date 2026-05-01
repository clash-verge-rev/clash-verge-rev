import { useCallback, useEffect, useReducer } from 'react'

import speedManager, { type SpeedUpdate } from '@/services/speed'

const PRESET_PROXY_NAMES = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']

const identity = (_: SpeedUpdate, next: SpeedUpdate): SpeedUpdate => next

const INITIAL_SPEED: SpeedUpdate = { speed: -1, updatedAt: 0 }

export interface UseProxySpeedState {
  speedState: SpeedUpdate
  speedValue: number // 原始值：-1 / -2 / 0 / MB/s
  isPreset: boolean
}

export function useProxySpeedState(
  proxy: IProxyItem,
  groupName: string,
): UseProxySpeedState {
  const isPreset = PRESET_PROXY_NAMES.includes(proxy.name)
  const [speedState, setSpeedState] = useReducer(identity, INITIAL_SPEED)

  // 为该代理注册 SpeedManager 更新监听器
  useEffect(() => {
    if (isPreset) return
    speedManager.setListener(proxy.name, groupName, setSpeedState)
    return () => speedManager.removeListener(proxy.name, groupName)
  }, [proxy.name, groupName, isPreset])

  // 挂载时从缓存加载初始值
  const updateFromCache = useCallback(() => {
    if (isPreset) return
    const cached = speedManager.getSpeedUpdate(proxy.name, groupName)
    if (cached) {
      setSpeedState(cached)
    }
  }, [proxy.name, groupName, isPreset])

  useEffect(() => {
    updateFromCache()
  }, [updateFromCache])

  return {
    speedState,
    speedValue: speedState.speed,
    isPreset,
  }
}
