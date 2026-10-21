import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type CaptureDomainCount,
  type CaptureFlowList,
  type CaptureQuery,
  type CaptureSettings,
  type CaptureStatus,
  addCaptureRule,
  clearCaptureFlows,
  getCaptureDomains,
  getCaptureFlowCount,
  getCaptureSettings,
  getCaptureStatus,
  listCaptureFlows,
  removeCaptureRule,
  startCapture,
  stopCapture,
  updateCaptureSettings,
  waitForCaptureChanges,
} from '@/services/capture'
import { mutate } from '@/services/mutate'

const REFRESH_INTERVAL = 2000
const EMPTY_QUERY: CaptureQuery = {
  page: 1,
  search: '',
  domain: '',
  status: '',
  type: '',
  method: '',
}

/** Owns capture state and orders background snapshots against user mutations. */
export const useCaptureSession = () => {
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [settings, setSettings] = useState<CaptureSettings | null>(null)
  const [flows, setFlows] = useState<CaptureFlowList | null>(null)
  const [domains, setDomains] = useState<CaptureDomainCount[]>([])
  const [query, setQuery] = useState<CaptureQuery>(EMPTY_QUERY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const versionRef = useRef(0)
  const pendingRef = useRef(0)
  const refreshCountRef = useRef(0)
  const eventPendingRef = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: Change notifications invalidate the current snapshot.
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    // A snapshot started before a mutation must never replace its committed result.
    const current = (revision: number) =>
      !disposed && !pendingRef.current && versionRef.current === revision

    const refresh = async () => {
      const revision = versionRef.current
      refreshCountRef.current++
      try {
        if (pendingRef.current) return
        const next = await getCaptureStatus()
        if (!current(revision)) return
        setStatus(next)

        if (next.running) {
          const [nextSettings, nextFlows, nextDomains] = await Promise.all([
            getCaptureSettings(),
            listCaptureFlows(query),
            getCaptureDomains(),
          ])
          if (!current(revision)) return
          setSettings(nextSettings)
          setFlows(nextFlows)
          setDomains(nextDomains)
        }
      } catch (nextError) {
        if (current(revision)) setError(String(nextError))
      } finally {
        refreshCountRef.current--
        if (
          !disposed &&
          refreshCountRef.current === 0 &&
          eventPendingRef.current
        ) {
          eventPendingRef.current = false
          setRefreshTick((tick) => tick + 1)
        }
        // Schedule after completion so slow IPC cannot accumulate overlapping refreshes.
        if (!disposed)
          timer = setTimeout(() => void refresh(), REFRESH_INTERVAL)
      }
    }

    void refresh()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [query, refreshTick])

  useEffect(() => {
    if (!status?.running) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let revision = 0
    const watch = async () => {
      try {
        const next = await waitForCaptureChanges(revision)
        if (disposed) return
        if (next.revision !== revision) {
          revision = next.revision
          // Finish an in-flight snapshot before scheduling another, even during bursts.
          if (refreshCountRef.current || pendingRef.current)
            eventPendingRef.current = true
          else setRefreshTick((tick) => tick + 1)
        }
        timer = setTimeout(() => void watch(), 0)
      } catch {
        // The ordinary status poll remains a fallback while the sidecar restarts.
        if (!disposed) timer = setTimeout(() => void watch(), REFRESH_INTERVAL)
      }
    }
    void watch()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [status?.running])

  const guard = useCallback(async <T>(action: () => Promise<T>) => {
    try {
      setError('')
      return await action()
    } catch (actionError) {
      setError(String(actionError))
      return undefined
    }
  }, [])

  // Lifecycle, settings, and deletion share one queue because they use the same sidecar.
  const runMutation = useCallback(
    async <T>(action: () => Promise<T>) => {
      versionRef.current++
      pendingRef.current++
      try {
        return await guard(async () => {
          const result = await mutate(action, {
            id: 'capture-session',
            errorNotice: false,
          })
          return result.ok ? result.value : undefined
        })
      } finally {
        versionRef.current++
        pendingRef.current--
        setRefreshTick((tick) => tick + 1)
      }
    },
    [guard],
  )

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      const next = await runMutation(async () => {
        const current = await getCaptureStatus()
        return current.running ? stopCapture() : startCapture()
      })
      if (next) setStatus(next)
    } finally {
      setBusy(false)
    }
  }, [runMutation])

  const setCapturing = useCallback(
    async (
      patch: Partial<Pick<CaptureSettings, 'enabled' | 'capture_all'>>,
    ) => {
      const next = await runMutation(async () => {
        // Read inside the queue: an earlier toggle may have changed the other field.
        const current = { ...(await getCaptureSettings()), ...patch }
        return updateCaptureSettings(current.enabled, current.capture_all)
      })
      if (next) setSettings(next)
    },
    [runMutation],
  )

  const addRule = useCallback(
    async (url: string) => {
      const next = await runMutation(() => addCaptureRule(url))
      if (next) setSettings(next)
    },
    [runMutation],
  )

  const removeRule = useCallback(
    async (id: number) => {
      const next = await runMutation(() => removeCaptureRule(id))
      if (next) setSettings(next)
    },
    [runMutation],
  )

  const countFlows = useCallback(
    (domain: string) => guard(() => getCaptureFlowCount(domain)),
    [guard],
  )

  const clearFlows = useCallback(
    async (domain: string) => {
      const result = await runMutation(() => clearCaptureFlows(domain))
      if (result) setQuery((prev) => ({ ...prev, page: 1 }))
      return result
    },
    [runMutation],
  )

  return {
    status,
    settings,
    flows,
    domains,
    query,
    busy,
    error,
    setQuery,
    toggle,
    setCapturing,
    addRule,
    removeRule,
    countFlows,
    clearFlows,
  }
}
