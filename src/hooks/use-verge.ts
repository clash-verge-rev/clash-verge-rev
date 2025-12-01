import useSWR from "swr";

import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import {
  getInitialVergeConfig,
  setInitialVergeConfig,
} from "@/services/preloaded-verge-config";

export const useVerge = () => {
  const initialVergeConfig = getInitialVergeConfig();
  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    async () => {
      const config = await getVergeConfig();
      setInitialVergeConfig(config);
      return config;
    },
    {
      fallbackData: initialVergeConfig ?? undefined,
      revalidateOnMount: !initialVergeConfig,
    },
  );

  const patchVerge = async (value: Partial<IVergeConfig>) => {
    await patchVergeConfig(value);
    mutateVerge();
  };

  return {
    verge,
    mutateVerge,
    patchVerge,
  };
};
