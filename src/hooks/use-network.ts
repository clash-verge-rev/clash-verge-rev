import { useQuery } from '@tanstack/react-query'

import { getNetworkInterfacesInfo } from '@/services/cmds'

export const useNetworkInterfaces = () => {
  const {
    data,
    error,
    isFetching,
    isLoading,
    refetch: mutate,
  } = useQuery({
    queryKey: ['getNetworkInterfacesInfo'],
    queryFn: getNetworkInterfacesInfo,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: [],
  })

  return {
    networkInterfaces: data || [],
    loading: isLoading || isFetching,
    error,
    mutate,
  }
}
