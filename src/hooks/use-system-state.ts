import {
  getRuntimeState,
  type RunState,
  type RunningMode,
} from '@/services/cmds'
import { useQuery } from '@/services/query-client'

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
