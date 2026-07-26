import { useEffect, useRef } from 'react'

import {
  getRuntimeState,
  type RunState,
  type RunningMode,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { useQuery } from '@/services/query-client'

import { useVerge } from './use-verge'
import { useVisibility } from './use-visibility'

export const runStateQueryKey = ['getRuntimeState'] as const

/**
 * Until the first snapshot arrives, assume the least capable environment: no service, no
 * elevation, nothing asked of the user. Guessing "ready" here would flash a usable TUN toggle.
 */
const unknownRunState: RunState = {
  mode: 'NotRunning',
  service: 'unknown',
  serviceUnavailableReason: null,
  pendingAction: null,
  sidecarAllowed: false,
  isAdmin: false,
  opInFlight: false,
  serviceUsable: false,
  tunCapable: false,
  serviceNeedsAttention: false,
}

/**
 * The Run State: how the core is running and what backs it.
 *
 * One query key, kept fresh by `verge://run-state-changed` rather than polling. Every derived
 * answer is computed in Rust and travels with the snapshot, so there is exactly one definition
 * of "TUN can work" in the app.
 */
export function useSystemState() {
  const pageVisible = useVisibility()

  const {
    data: runState = unknownRunState,
    refetch: mutateSystemState,
    isLoading,
  } = useQuery({
    queryKey: runStateQueryKey,
    queryFn: getRuntimeState,
    // A safety net only: transitions are pushed, so this is not the primary path.
    refetchInterval: pageVisible ? 30000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  return {
    runState,
    runningMode: runState.mode as RunningMode,
    isAdminMode: runState.isAdmin,
    isSidecarMode: runState.mode === 'Sidecar',
    isServiceMode: runState.mode === 'Service',
    isTunModeAvailable: runState.tunCapable,
    serviceNeedsAttention: runState.serviceNeedsAttention,
    mutateSystemState,
    isLoading,
  }
}

export function useTunAvailabilityGuard() {
  const { verge, patchVerge } = useVerge()
  const { runState, isTunModeAvailable, isLoading } = useSystemState()
  // The service reports 'unknown' until it has actually been probed, which replaces the
  // fixed startup grace period this guard used to wait out before trusting the answer.
  const serviceUndecided =
    runState.service === 'unknown' ||
    runState.opInFlight ||
    runState.serviceNeedsAttention
  const disablingTunRef = useRef(false)
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enable_tun_mode = verge?.enable_tun_mode

  useEffect(() => {
    if (enable_tun_mode === undefined) return

    if (
      !disablingTunRef.current &&
      enable_tun_mode &&
      !isTunModeAvailable &&
      !serviceUndecided &&
      !isLoading
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
  }, [
    enable_tun_mode,
    isTunModeAvailable,
    serviceUndecided,
    patchVerge,
    isLoading,
  ])
}
