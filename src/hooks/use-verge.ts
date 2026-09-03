import { useCallback, useState } from 'react'

import {
  getDefaultVergeConfig,
  getVergeConfig,
  patchVergeConfig,
} from '@/services/cmds'
import { getPreloadConfig, setPreloadConfig } from '@/services/preload'
import { getCacheData, setCacheData, useQuery } from '@/services/query-client'

export const useVerge = () => {
  const initialVergeConfig = getPreloadConfig()

  const { data: verge, refetch } = useQuery({
    queryKey: ['getVergeConfig'],
    queryFn: async () => {
      const config = await getVergeConfig()
      setPreloadConfig(config)
      return config
    },
    initialData: initialVergeConfig ?? undefined,
    revalidateOnMount: initialVergeConfig ? false : undefined,
    staleTime: 5000,
  })

  const mutateVerge = (
    updaterOrData?:
      | IVergeConfig
      | ((prev: IVergeConfig | undefined) => IVergeConfig | undefined)
      | undefined,
    _revalidate?: boolean,
  ) => {
    if (updaterOrData === undefined) {
      void refetch()
      return
    }
    if (typeof updaterOrData === 'function') {
      const prev = getCacheData<IVergeConfig>(['getVergeConfig'])
      const next = updaterOrData(prev)
      setCacheData(['getVergeConfig'], next)
    } else {
      setCacheData(['getVergeConfig'], updaterOrData)
    }
  }

  const patchVerge = useCallback(
    async (value: Partial<IVergeConfig>) => {
      await patchVergeConfig(value)
      await refetch()
    },
    [refetch],
  )

  return {
    verge,
    mutateVerge,
    patchVerge,
  }
}

export const useVergeConfigField = <T extends keyof IVergeConfig>(
  field: T,
  fallbackValue: NonNullable<IVergeConfig[T]>,
  isModified?: (
    value: IVergeConfig[T] | undefined,
    defaultValue: IVergeConfig[T] | undefined,
  ) => boolean,
): ConfigField<IVergeConfig[T]> => {
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { data: defaultVergeConfig } = useQuery({
    queryKey: ['getDefaultVergeConfig'],
    queryFn: getDefaultVergeConfig,
  })
  return {
    value: verge?.[field] ?? fallbackValue,
    defaultValue: defaultVergeConfig?.[field] ?? fallbackValue,
    modified: isModified
      ? isModified(verge?.[field], defaultVergeConfig?.[field])
      : verge?.[field] !== defaultVergeConfig?.[field],
    mutate: async function (newValue: IVergeConfig[T]): Promise<void> {
      await mutateVerge((prev) => ({
        ...prev,
        [field]: newValue,
      }))
    },
    patch: async function (newValue: IVergeConfig[T]): Promise<void> {
      await patchVerge({ [field]: newValue })
    },
    reset: async function (): Promise<void> {
      if (defaultVergeConfig) {
        await patchVerge({ [field]: defaultVergeConfig[field] })
      }
    },
  }
}

export const useCachedVergeConfigField = <T extends keyof IVergeConfig>(
  field: T,
  fallbackValue: NonNullable<IVergeConfig[T]>,
  isModified?: (
    value: IVergeConfig[T] | undefined,
    defaultValue: IVergeConfig[T] | undefined,
  ) => boolean,
): CachedConfigField<IVergeConfig[T]> => {
  const { value, defaultValue, patch } = useVergeConfigField(
    field,
    fallbackValue,
    isModified,
  )
  const [cachedValue, setCachedValue] = useState(value ?? fallbackValue)
  return {
    value: cachedValue ?? fallbackValue,
    defaultValue: defaultValue ?? fallbackValue,
    modified: cachedValue !== (defaultValue ?? fallbackValue),
    set: function (newValue: IVergeConfig[T]): void {
      setCachedValue(newValue ?? fallbackValue)
    },
    reset: function (): void {
      setCachedValue(defaultValue ?? fallbackValue)
    },
    refetch: function () {
      setCachedValue(value ?? fallbackValue)
    },
    save: async function (): Promise<void> {
      await patch(cachedValue)
    },
  }
}
