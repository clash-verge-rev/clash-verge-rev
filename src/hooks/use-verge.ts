import useSWR from "swr";

import { getVergeConfig, patchVergeConfig } from "@/services/cmds";

export const useVerge = () => {
  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    async () => {
      const config = await getVergeConfig();
      return config;
    },
  );

  const patchVerge = async (
    value: Partial<IVergeConfig>,
    options?: { optimistic?: (prev: IVergeConfig | undefined) => IVergeConfig },
  ) => {
    if (options?.optimistic) {
      // 乐观更新本地配置,避免 UI 被旧配置覆盖
      mutateVerge((prev: IVergeConfig | undefined) => {
        if (!prev) return prev as any;
        return options.optimistic?.(prev) ?? prev;
      }, false);
    }

    await patchVergeConfig(value);

    if (!options?.optimistic) {
      // 兼容旧调用方式：没有传 optimistic 时，仍然从远端刷新一次
      mutateVerge();
    }
  };

  return {
    verge,
    mutateVerge,
    patchVerge,
  };
};
