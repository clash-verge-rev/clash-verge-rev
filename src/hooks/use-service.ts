import { checkService } from "@/services/cmds";
import useSWR from "swr";

export const useService = () => {
  const { data: serviceStatus, mutate: mutateCheckService } = useSWR(
    "checkService",
    checkService,
    {
      revalidateIfStale: false,
      shouldRetryOnError: false,
      focusThrottleInterval: 36e5, // 1 hour
    },
  );

  return { serviceStatus, mutateCheckService };
};
