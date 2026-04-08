import { useQuery } from '@tanstack/react-query'

import { getNetworkInterfacesInfo } from '@/services/cmds'

export const useNetworkInterfaces = () => {
  const {
    data,
    error,
    isLoading,
    refetch: mutate,
  } = useQuery({
    queryKey: ['getNetworkInterfacesInfo'],
    queryFn: getNetworkInterfacesInfo,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: [],
  })

  return {
    networkInterfaces: data || [],
    loading: isLoading,
    error,
    mutate,
  }
}
