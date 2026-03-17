import useSWR from 'swr'

import {
  getNetworkInterfacesInfo,
  NETWORK_INTERFACES_INFO_QUERY_KEY,
} from '@/services/cmds'

export const useNetworkInterfaces = () => {
  const { data, error, isLoading, mutate } = useSWR(
    NETWORK_INTERFACES_INFO_QUERY_KEY,
    getNetworkInterfacesInfo,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      fallbackData: [],
    },
  )

  return {
    networkInterfaces: data ?? [],
    loading: isLoading,
    error,
    mutate,
  }
}
