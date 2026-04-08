import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 3,
      retryDelay: 5000,
      refetchOnWindowFocus: false,
    },
  },
})
