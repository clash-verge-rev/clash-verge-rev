import { unstable_serialize } from 'swr'
import useSWR, {
  type SWRConfiguration,
  type SWRResponse,
  mutate as swrMutate,
} from 'swr'

import { BoundedMap } from '@/utils/bounded-cache'

const QUERY_CACHE_MAX_SIZE = 1000
const SWR_CACHE_MAX_SIZE = 2000

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

const serializeQueryKey = (queryKey: QueryKey) => unstable_serialize(queryKey)

const queryCache = new BoundedMap<string, unknown>(QUERY_CACHE_MAX_SIZE)

const subscriptionKeysByPrefix = new Map<string, Set<string>>()

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

/**
 * SWR cache provider with a hard size limit. Without this, rotating
 * WebSocket subscription keys (e.g. `$sub$getClashLog-<timestamp>`) would
 * grow the SWR in-memory cache without bound.
 *
 * Values are typed as `any` because SWR owns the cache state shape internally.
 */
export const swrCacheProvider = () =>
  new BoundedMap<string, any>(SWR_CACHE_MAX_SIZE)

export const getCacheData = <T>(queryKey: QueryKey): T | undefined => {
  return queryCache.get(serializeQueryKey(queryKey)) as T | undefined
}

const updateCachedData = <T>(
  queryKey: QueryKey,
  updaterOrData: QueryDataUpdater<T>,
) => {
  const current = getCacheData<T>(queryKey)
  const next =
    typeof updaterOrData === 'function'
      ? (updaterOrData as (current: T | undefined) => T | undefined)(current)
      : updaterOrData
  setCachedData(queryKey, next)
  return next
}

export const setCacheData = <T>(
  queryKey: QueryKey,
  updaterOrData: QueryDataUpdater<T>,
) => {
  const next = updateCachedData(queryKey, updaterOrData)
  void swrMutate(queryKey, next, {
    populateCache: true,
    revalidate: false,
  })
  return next
}

export const setCacheDataAsync = async <T>(
  queryKey: QueryKey,
  updaterOrData: QueryDataUpdater<T>,
) => {
  const next = updateCachedData(queryKey, updaterOrData)
  await swrMutate(queryKey, next, {
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

/**
 * Register a subscription cache key so that old keys of the same prefix can be
 * cleaned up when the subscription rotates (e.g. `$sub$getClashLog-<timestamp>`).
 */
export const registerSubscriptionKey = (prefix: string, queryKey: QueryKey) => {
  const serializedKey = serializeQueryKey(queryKey)
  const keys = subscriptionKeysByPrefix.get(prefix) ?? new Set<string>()
  keys.add(serializedKey)
  subscriptionKeysByPrefix.set(prefix, keys)
  return serializedKey
}

/**
 * Remove all subscription cache entries for a given prefix except the current
 * one. This prevents unbounded growth when subscriptions refresh with new
 * timestamp keys.
 */
export const cleanupSubscriptionKeys = (
  prefix: string,
  currentKey?: QueryKey,
) => {
  const currentSerialized =
    currentKey === undefined ? undefined : serializeQueryKey(currentKey)
  const keys = subscriptionKeysByPrefix.get(prefix)
  if (!keys) return Promise.resolve()

  const cleanups: Promise<unknown>[] = []
  for (const serializedKey of keys) {
    if (serializedKey === currentSerialized) continue
    cleanups.push(removeCacheData(serializedKey))
  }

  keys.clear()
  if (currentSerialized !== undefined) {
    keys.add(currentSerialized)
  }

  return Promise.all(cleanups)
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
