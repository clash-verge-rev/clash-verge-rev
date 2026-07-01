import { unstable_serialize } from 'swr'
import useSWR, {
  type SWRConfiguration,
  type SWRResponse,
  mutate as swrMutate,
} from 'swr'

type QueryKey = string | readonly unknown[]

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

const serializeQueryKey = (queryKey: QueryKey) => unstable_serialize(queryKey)

export const queryCache = new Map<string, unknown>()

const setCachedData = <T>(queryKey: QueryKey, data: T | undefined) => {
  const cacheKey = serializeQueryKey(queryKey)
  if (data === undefined) {
    queryCache.delete(cacheKey)
  } else {
    queryCache.set(cacheKey, data)
  }
}

export const swrConfig: SWRConfiguration = {
  dedupingInterval: 2000,
  errorRetryCount: 3,
  errorRetryInterval: 5000,
  revalidateOnFocus: false,
}

export const getCacheData = <T>(queryKey: QueryKey): T | undefined => {
  return queryCache.get(serializeQueryKey(queryKey)) as T | undefined
}

export const setCacheData = <T>(
  queryKey: QueryKey,
  updaterOrData: T | undefined | ((current: T | undefined) => T | undefined),
) => {
  const current = getCacheData<T>(queryKey)
  const next =
    typeof updaterOrData === 'function'
      ? (updaterOrData as (current: T | undefined) => T | undefined)(current)
      : updaterOrData

  setCachedData(queryKey, next)

  void swrMutate(queryKey, next, {
    populateCache: true,
    revalidate: false,
  })
  return next
}

export const revalidateQuery = async (queryKey: QueryKey) => {
  const data = await swrMutate(queryKey)
  if (data !== undefined) {
    setCachedData(queryKey, data)
  }
  return data
}

export const revalidateQueries = (queryKeys: readonly QueryKey[]) =>
  Promise.all(queryKeys.map(revalidateQuery))

export const removeCacheData = (queryKey: QueryKey) => {
  setCachedData(queryKey, undefined)
  return swrMutate(queryKey, undefined, {
    populateCache: true,
    revalidate: false,
  })
}

export const fetchCacheData = async <T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T> | T,
) => {
  const data = await queryFn()
  setCacheData(queryKey, data)
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
  const serializedKey = serializeQueryKey(queryKey)
  if (enabled && fallbackData !== undefined && !queryCache.has(serializedKey)) {
    setCachedData(queryKey, fallbackData)
  }

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
    onSuccess: (data) => {
      setCachedData(queryKey, data)
    },
  })

  return {
    ...swr,
    isFetching: swr.isValidating,
    isPending: swr.isLoading,
    refetch: async () => {
      const data = await swr.mutate()
      if (data !== undefined) {
        setCachedData(queryKey, data)
      }
      return { data }
    },
  }
}
