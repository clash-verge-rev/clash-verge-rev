import { useQuery } from '@tanstack/react-query'

import { getNetworkInterfacesInfo } from '@/services/cmds'

export const useNetworkInterfaces = () => {
  const {
    data,
    error,
    isLoading,
    isFetching,
    refetch: mutate,
  } = useQuery({
    queryKey: ['getNetworkInterfacesInfo'],
    queryFn: async () => {
      try {
        const res = await getNetworkInterfacesInfo()
        console.log('[Network] Backend returned interfaces:', res)
        return res
      } catch (err) {
        console.error('[Network] Backend returned error:', err)
        throw err
      }
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: [],
  })

  return {
    networkInterfaces: data || [],
    loading: isLoading || isFetching,
    error,
    mutate,
  }
}
