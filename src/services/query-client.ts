import useSWR, {
  type SWRConfiguration,
  type SWRResponse,
  mutate as swrMutate,
} from 'swr'

type QueryKey = string | readonly unknown[]
type QueryDataUpdater<T> =
  | T
  | undefined
  | ((current: T | undefined) => T | undefined)

type QueryOptions<T> = {
  queryKey: QueryKey
  queryFn: () => Promise<T> | T
  enabled?: boolean
  initialData?: T | (() => T | undefined)
  placeholderData?: T | (() => T | undefined)
  staleTime?: number
  retry?: number | false
  retryDelay?: number | ((attempt: number) => number)
  refetchInterval?: number | false
  refetchIntervalInBackground?: boolean
  revalidateOnMount?: boolean
  refetchOnWindowFocus?: boolean
  refetchOnReconnect?: boolean
}

type QueryResult<T> = SWRResponse<T> & {
  isFetching: boolean
  isPending: boolean
  refetch: () => Promise<{ data: T | undefined }>
}

export const swrConfig: SWRConfiguration = {
  dedupingInterval: 2000,
  errorRetryCount: 3,
  errorRetryInterval: 5000,
  revalidateOnFocus: false,
}

export const setCacheData = <T>(
  queryKey: QueryKey,
  updaterOrData: QueryDataUpdater<T>,
) =>
  swrMutate<T>(queryKey, updaterOrData, {
    populateCache: true,
    revalidate: false,
  })

export const revalidateQuery = (queryKey: QueryKey) => swrMutate(queryKey)

export const revalidateQueries = (queryKeys: readonly QueryKey[]) =>
  Promise.all(queryKeys.map(revalidateQuery))

export const removeCacheData = (queryKey: QueryKey) =>
  setCacheData(queryKey, undefined)

export const fetchCacheData = async <T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T> | T,
) => {
  const data = await queryFn()
  await setCacheData(queryKey, data)
  return data
}

export function useQuery<T>(options: QueryOptions<T>): QueryResult<T> {
  const {
    queryKey,
    queryFn,
    enabled = true,
    initialData,
    placeholderData,
    retry,
    retryDelay,
    refetchInterval,
    refetchIntervalInBackground,
    revalidateOnMount,
    refetchOnWindowFocus,
    refetchOnReconnect,
    staleTime,
  } = options

  const fallbackDataSource = initialData ?? placeholderData
  const fallbackData =
    typeof fallbackDataSource === 'function'
      ? (fallbackDataSource as () => T | undefined)()
      : fallbackDataSource
  const swr = useSWR<T>(enabled ? queryKey : null, queryFn, {
    dedupingInterval: staleTime,
    errorRetryCount: retry === false ? 0 : retry,
    errorRetryInterval:
      typeof retryDelay === 'number'
        ? retryDelay
        : swrConfig.errorRetryInterval,
    fallbackData,
    keepPreviousData: placeholderData !== undefined,
    onErrorRetry: (_error, _key, config, revalidate, { retryCount }) => {
      const maxRetries = config.errorRetryCount
      if (maxRetries !== undefined && retryCount > maxRetries) return

      const interval =
        typeof retryDelay === 'function'
          ? retryDelay(Math.max(retryCount - 1, 0))
          : config.errorRetryInterval

      setTimeout(() => {
        revalidate({ retryCount, dedupe: true })
      }, interval)
    },
    revalidateOnFocus: refetchOnWindowFocus,
    revalidateOnMount,
    revalidateOnReconnect: refetchOnReconnect,
    refreshInterval: refetchInterval || 0,
    refreshWhenHidden: refetchIntervalInBackground ?? false,
  })

  return {
    ...swr,
    isFetching: swr.isValidating,
    isPending: swr.isLoading,
    refetch: async () => ({ data: await swr.mutate() }),
  }
}
