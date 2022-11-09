import useSWR from "swr";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";

export const useVergeConfig = () => {
  const { data, mutate } = useSWR("getVergeConfig", getVergeConfig);

  const patchVerge = async (value: Partial<CmdType.VergeConfig>) => {
    await patchVergeConfig(value);
    mutate();
  };

  return {
    data,
    patchVerge,
  };
};
