import { getNetworkInterfacesInfo } from '@/services/cmds'
import { useQuery } from '@/services/query-client'

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
