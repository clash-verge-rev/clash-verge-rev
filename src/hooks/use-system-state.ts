import {
  getRuntimeState,
  type RunState,
  type RunningMode,
} from '@/services/cmds'
import { useQuery } from '@/services/query-client'

import { useVisibility } from './use-visibility'

export const runStateQueryKey = ['getRuntimeState'] as const

/** Fail closed until the first snapshot so TUN never flashes as available. */
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

/** Event-driven run state; Rust owns all derived availability decisions. */
export function useSystemState() {
  const pageVisible = useVisibility()

  const {
    data: runState = unknownRunState,
    refetch: mutateSystemState,
    isLoading,
  } = useQuery({
    queryKey: runStateQueryKey,
    queryFn: getRuntimeState,
    // A safety net only; transitions normally arrive by event.
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
