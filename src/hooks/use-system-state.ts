import { getAppUptime, type RunState, type RunningMode } from '@/services/cmds'
import { useQuery } from '@/services/query-client'
import { useAppReads, useRunState } from '@/store/app-store-context'

const appUptimeQueryKey = ['appUptime'] as const

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
  const { readRunState } = useAppReads()
  const snapshot = useRunState()
  const runState = snapshot ?? unknownRunState

  return {
    runState,
    runningMode: runState.mode as RunningMode,
    isAdminMode: runState.isAdmin,
    isSidecarMode: runState.mode === 'Sidecar',
    isServiceMode: runState.mode === 'Service',
    isTunModeAvailable: runState.tunCapable,
    serviceNeedsAttention: runState.serviceNeedsAttention,
    mutateSystemState: readRunState,
    isLoading: snapshot == null,
  }
}

export function useAppUptime() {
  const { data: uptime = 0 } = useQuery({
    queryKey: appUptimeQueryKey,
    queryFn: getAppUptime,
    staleTime: 5000,
    refetchInterval: 3000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  })

  return uptime
}
