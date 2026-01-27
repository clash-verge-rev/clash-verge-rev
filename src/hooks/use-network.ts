import useSWR from "swr";

import { getNetworkInterfacesInfo } from "@/services/cmds";

export const useNetworkInterfaces = () => {
  const { data, error, isLoading, mutate } = useSWR(
    "getNetworkInterfacesInfo",
    getNetworkInterfacesInfo,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      fallbackData: [],
    },
  );

  return {
    networkInterfaces: data || [],
    loading: isLoading,
    error,
    mutate,
  };
};
