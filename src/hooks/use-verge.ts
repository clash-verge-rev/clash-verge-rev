import useSWR from "swr";

import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { getPreloadConfig, setPreloadConfig } from "@/services/preload";

export const useVerge = () => {
  const initialVergeConfig = getPreloadConfig();
  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    async () => {
      const config = await getVergeConfig();
      setPreloadConfig(config);
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
