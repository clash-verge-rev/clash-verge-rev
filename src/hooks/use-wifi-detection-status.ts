import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'

import {
  getWifiDetectionStatus,
  type IWifiDetectionStatus,
} from '@/services/cmds'

export const WIFI_DETECTION_QUERY_KEY = ['getWifiDetectionStatus'] as const

/**
 * Wi-Fi 识别开关 + 授权状态（macOS 有效）的快照。
 *
 * 刷新策略：
 * - 打开设置页时 useQuery 首次拉取
 * - 后端 CoreLocation delegate 授权变化时 emit `verge://wifi-auth-changed`
 *   （专用事件，与 network-context-updated 解耦——Denied 场景 sampler
 *   fingerprint 不变，不会走 netmon PUT 路径，必须独立事件驱动 UI）
 * - 后端 netmon 成功 PUT 时 emit `verge://network-context-updated`，
 *   授权为 Authorized 时 ssid 采集成功会走这条路径
 * - 不做 refetchInterval：状态变化必经后端事件，轮询没有意义
 */
export const useWifiDetectionStatus = () => {
  const queryClient = useQueryClient()
  const query = useQuery<IWifiDetectionStatus>({
    queryKey: WIFI_DETECTION_QUERY_KEY,
    queryFn: getWifiDetectionStatus,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 2000,
  })

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: WIFI_DETECTION_QUERY_KEY })
    }
    const unlistenAuth = listen('verge://wifi-auth-changed', invalidate)
    const unlistenCtx = listen('verge://network-context-updated', invalidate)
    return () => {
      unlistenAuth.then((fn) => fn()).catch(() => {})
      unlistenCtx.then((fn) => fn()).catch(() => {})
    }
  }, [queryClient])

  return query
}
