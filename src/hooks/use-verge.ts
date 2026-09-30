import { useCallback } from 'react'

import { getVergeConfig, patchVergeConfig } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { getPreloadConfig, setPreloadConfig } from '@/services/preload'
import { setCacheData, useQuery } from '@/services/query-client'

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
    void setCacheData<IVergeConfig>(
      ['getVergeConfig'],
      typeof updaterOrData === 'function'
        ? (current) => updaterOrData(current ?? verge)
        : updaterOrData,
    )
  }

  const patchVerge = useCallback(async (value: Partial<IVergeConfig>) => {
    await mutate(() => patchVergeConfig(value), {
      id: 'patch-verge-config',
      revalidate: [['getVergeConfig']],
    })
  }, [])

  return {
    verge,
    mutateVerge,
    patchVerge,
  }
}
