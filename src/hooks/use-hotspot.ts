import { useCallback } from 'react'

import {
  getHotspotStatus,
  listHotspotAdapters,
  startHotspot,
  stopHotspot,
  type HotspotAdapter,
  type HotspotStartConfig,
  type HotspotStatus,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { useQuery } from '@/services/query-client'

const HOTSPOT_STATUS_KEY = ['getHotspotStatus']
const HOTSPOT_ADAPTERS_KEY = ['listHotspotAdapters']

export const DEFAULT_HOTSPOT_SSID = 'ClashVerge'

export const useHotspotStatus = () => {
  const { data, refetch } = useQuery({
    queryKey: HOTSPOT_STATUS_KEY,
    queryFn: getHotspotStatus,
    // Events push transitions; polling covers a dropped event or a hidden window.
    refetchInterval: 3000,
  })

  return { status: data as HotspotStatus | undefined, refetch }
}

export const useHotspotAdapters = (): HotspotAdapter[] => {
  const { data } = useQuery({
    queryKey: HOTSPOT_ADAPTERS_KEY,
    queryFn: listHotspotAdapters,
    revalidateOnMount: true,
  })

  return (data ?? []) as HotspotAdapter[]
}

export const useHotspotActions = () => {
  const start = useCallback(
    (config: HotspotStartConfig) =>
      mutate(() => startHotspot(config), {
        id: 'start-hotspot',
        revalidate: [HOTSPOT_STATUS_KEY],
        errorNotice: false,
      }),
    [],
  )

  const stop = useCallback(
    () =>
      mutate(() => stopHotspot(), {
        id: 'stop-hotspot',
        revalidate: [HOTSPOT_STATUS_KEY],
        errorNotice: false,
      }),
    [],
  )

  return { start, stop }
}
