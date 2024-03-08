import useSWR from "swr";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";

export const useVerge = () => {
  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    getVergeConfig
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
