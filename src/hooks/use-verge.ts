import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

import { useSystemState } from "@/hooks/use-system-state";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

export const useVerge = () => {
  const { t } = useTranslation();
  const { isTunModeAvailable, isLoading } = useSystemState();

  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    async () => {
      const config = await getVergeConfig();
      return config;
    },
  );

  const patchVerge = async (value: Partial<IVergeConfig>) => {
    await patchVergeConfig(value);
    mutateVerge();
  };

  const { enable_tun_mode } = verge ?? {};

  // 当服务不可用且TUN模式开启时自动关闭TUN
  useEffect(() => {
    if (enable_tun_mode && !isTunModeAvailable && !isLoading) {
      console.log("[useVerge] 检测到服务不可用，自动关闭TUN模式");

      patchVergeConfig({ enable_tun_mode: false })
        .then(() => {
          mutateVerge();
          showNotice(
            "info",
            t("TUN Mode automatically disabled due to service unavailable"),
          );
        })
        .catch((err) => {
          console.error("[useVerge] 自动关闭TUN模式失败:", err);
          showNotice("error", t("Failed to disable TUN Mode automatically"));
        });
    }
  }, [isTunModeAvailable, isLoading, enable_tun_mode, mutateVerge, t]);

  return {
    verge,
    mutateVerge,
    patchVerge,
  };
};
