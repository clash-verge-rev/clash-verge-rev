import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

import { useSystemState } from "@/hooks/use-system-state";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

export const useVerge = () => {
  const { t } = useTranslation();
  const { isTunModeAvailable, isServiceMode, isLoading } = useSystemState();
  const disablingRef = useRef(false);

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

  const mutateVergeRef = useRef(mutateVerge);
  const tRef = useRef(t);
  const enableTunRef = useRef(enable_tun_mode);
  const isLoadingRef = useRef(isLoading);
  const isServiceModeRef = useRef(isServiceMode);

  mutateVergeRef.current = mutateVerge;
  tRef.current = t;
  enableTunRef.current = enable_tun_mode;
  isLoadingRef.current = isLoading;
  isServiceModeRef.current = isServiceMode;

  const doDisable = useCallback(async () => {
    try {
      if (isServiceModeRef.current === true) return;
      await patchVergeConfig({ enable_tun_mode: false });
      await mutateVergeRef.current?.();
      showNotice(
        "info",
        tRef.current(
          "TUN Mode automatically disabled due to service unavailable",
        ),
      );
    } catch (err) {
      console.error("[useVerge] 自动关闭TUN模式失败:", err);
      showNotice(
        "error",
        tRef.current("Failed to disable TUN Mode automatically"),
      );
    } finally {
      disablingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isTunModeAvailable === true) return;
    if (isLoadingRef.current === true) return;
    if (enableTunRef.current !== true) return;
    if (isServiceModeRef.current === true) return;
    if (disablingRef.current) return;

    disablingRef.current = true;
    void doDisable();
  }, [isTunModeAvailable, doDisable]);

  return {
    verge,
    mutateVerge,
    patchVerge,
  };
};
