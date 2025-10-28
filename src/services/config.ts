import { useSWRConfig } from "swr";

export const SWR_DEFAULTS = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  suspense: false,
  errorRetryCount: 2,
  dedupingInterval: 5000,
} as const;

export const SWR_REALTIME = {
  ...SWR_DEFAULTS,
  refreshInterval: 8000,
  dedupingInterval: 3000,
} as const;

export const SWR_SLOW_POLL = {
  ...SWR_DEFAULTS,
  refreshInterval: 60000,
} as const;

export const useSWRMutate = () => {
  const { mutate } = useSWRConfig();
  return mutate;
};
