import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { getRunningMode, isAdmin, isServiceAvailable } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

import { useVerge } from './use-verge'

export interface SystemState {
  runningMode: 'Sidecar' | 'Service'
  isAdminMode: boolean
  isServiceOk: boolean
}

const defaultSystemState = {
  runningMode: 'Sidecar',
  isAdminMode: false,
  isServiceOk: false,
} as SystemState

// Grace period for service initialization during startup
const STARTUP_GRACE_MS = 10_000

/**
 * 自定义 hook 用于获取系统运行状态
 * 包括运行模式、管理员状态、系统服务是否可用
 */
export function useSystemState() {
  const { verge, patchVerge } = useVerge()
  const disablingTunRef = useRef(false)
  const [isStartingUp, setIsStartingUp] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setIsStartingUp(false), STARTUP_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])

  const {
    data: systemState = defaultSystemState,
    refetch: mutateSystemState,
    isLoading,
  } = useQuery({
    queryKey: ['getSystemState'],
    queryFn: async () => {
      const [runningMode, isAdminMode, isServiceOk] = await Promise.all([
        getRunningMode(),
        isAdmin(),
        isServiceAvailable(),
      ])
      return { runningMode, isAdminMode, isServiceOk } as SystemState
    },
    refetchInterval: isStartingUp ? 2000 : 30000,
  })

  const isSidecarMode = systemState.runningMode === 'Sidecar'
  const isServiceMode = systemState.runningMode === 'Service'
  const isTunModeAvailable = systemState.isAdminMode || systemState.isServiceOk

  const enable_tun_mode = verge?.enable_tun_mode
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (enable_tun_mode === undefined) return

    if (
      !disablingTunRef.current &&
      enable_tun_mode &&
      !isTunModeAvailable &&
      !isLoading &&
      !isStartingUp
    ) {
      disablingTunRef.current = true
      patchVerge({ enable_tun_mode: false })
        .then(() => {
          showNotice.info(
            'settings.sections.system.notifications.tunMode.autoDisabled',
          )
        })
        .catch((err) => {
          console.error('[useVerge] 自动关闭TUN模式失败:', err)
          showNotice.error(
            'settings.sections.system.notifications.tunMode.autoDisableFailed',
          )
        })
        .finally(() => {
          // 避免 verge 数据更新不及时导致重复执行关闭 Tun 模式
          cooldownTimerRef.current = setTimeout(() => {
            disablingTunRef.current = false
            cooldownTimerRef.current = null
          }, 1000)
        })
    }

    return () => {
      if (cooldownTimerRef.current != null) {
        clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
        disablingTunRef.current = false
      }
    }
  }, [enable_tun_mode, isTunModeAvailable, patchVerge, isLoading, isStartingUp])

  return {
    runningMode: systemState.runningMode,
    isAdminMode: systemState.isAdminMode,
    isServiceOk: systemState.isServiceOk,
    isSidecarMode,
    isServiceMode,
    isTunModeAvailable,
    mutateSystemState,
    isLoading,
  }
}
