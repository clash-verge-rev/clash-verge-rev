import { useQuery } from '@tanstack/react-query'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useMemo } from 'react'

import { downloadIconCache } from '@/services/cmds'

export interface UseIconCacheOptions {
  icon?: string | null
  cacheKey?: string
  enabled?: boolean
}

const getFileNameFromUrl = (url: string) => {
  const lastSlashIndex = url.lastIndexOf('/')
  return lastSlashIndex >= 0 ? url.slice(lastSlashIndex + 1) : url
}

export const useIconCache = ({
  icon,
  cacheKey,
  enabled = true,
}: UseIconCacheOptions) => {
  const iconValue = icon?.trim() ?? ''
  const cacheKeyValue = cacheKey?.trim() ?? ''

  const isEnabled = useMemo(() => {
    return enabled && iconValue.startsWith('http') && cacheKeyValue !== ''
  }, [enabled, iconValue, cacheKeyValue])

  const { data } = useQuery({
    queryKey: ['icon-cache', iconValue, cacheKeyValue],
    queryFn: async () => {
      try {
        const fileName = `${cacheKeyValue}-${getFileNameFromUrl(iconValue)}`
        const iconPath = await downloadIconCache(iconValue, fileName)
        return convertFileSrc(iconPath)
      } catch {
        return ''
      }
    },
    enabled: isEnabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 2,
  })

  if (!isEnabled) {
    return ''
  }

  return data ?? ''
}
