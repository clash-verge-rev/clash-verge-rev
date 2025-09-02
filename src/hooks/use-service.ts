import { checkService } from "@/services/cmds";
import useSWR from "swr";

export const useService = () => {
  const { data: serviceStatus, mutate: mutateCheckService } = useSWR<
    "active" | "installed" | "uninstall" | "unknown"
  >("checkService", checkService, {
    revalidateIfStale: false,
    shouldRetryOnError: false,
    focusThrottleInterval: 36e5, // 1 hour
    fallbackData: "uninstall",
  });

  return { serviceStatus, mutateCheckService };
};
