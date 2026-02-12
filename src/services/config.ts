const SWR_NOT_SMART = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  suspense: false,
  errorRetryCount: 2,
  dedupingInterval: 1500,
  errorRetryInterval: 3000,
} as const;

export const SWR_DEFAULTS = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  suspense: false,
  errorRetryCount: 2,
  dedupingInterval: 5000,
} as const;

export const SWR_SLOW_POLL = {
  ...SWR_DEFAULTS,
  refreshInterval: 60000,
} as const;

export const SWR_MIHOMO = {
  ...SWR_NOT_SMART,
  errorRetryInterval: 500,
  errorRetryCount: 15,
};

export const SWR_EXTERNAL_API = {
  ...SWR_NOT_SMART,
  shouldRetryOnError: true,
  errorRetryCount: 1,
  errorRetryInterval: 30_000,
} as const;
