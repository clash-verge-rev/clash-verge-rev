import { useCallback } from 'react'

import { getVergeConfig, patchVergeConfig } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { getPreloadConfig, setPreloadConfig } from '@/services/preload'
import {
  revalidateQuery,
  setCacheData,
  useQuery,
} from '@/services/query-client'

export const useVerge = () => {
  const initialVergeConfig = getPreloadConfig()

  const { data: verge } = useQuery({
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

  // Stable identity: many consumers list mutateVerge in their own callback
  // deps, so a per-render closure here would churn their memoization too.
  // The updater receives the live cache value (preload snapshot when the
  // cache is still empty) instead of a render-time snapshot, so an older
  // render cannot clobber a newer cache write.
  const mutateVerge = useCallback(
    (
      updater?: (prev: IVergeConfig | undefined) => IVergeConfig | undefined,
    ) => {
      if (updater === undefined) {
        void revalidateQuery(['getVergeConfig'])
        return
      }
      void setCacheData<IVergeConfig>(['getVergeConfig'], (current) =>
        updater(current ?? getPreloadConfig() ?? undefined),
      )
    },
    [],
  )

  // Callers own the error toast (GuardState onCatch / page onError), so the
  // funnel must not add a second one.
  const patchVerge = useCallback(async (value: Partial<IVergeConfig>) => {
    await mutate(() => patchVergeConfig(value), {
      id: 'patch-verge-config',
      revalidate: [['getVergeConfig']],
      errorNotice: false,
    })
  }, [])

  return {
    verge,
    mutateVerge,
    patchVerge,
  }
}
