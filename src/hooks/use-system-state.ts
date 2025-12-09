import { useEffect } from "react";
import useSWR from "swr";

import { getRunningMode, isAdmin, isServiceAvailable } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

import { useVerge } from "./use-verge";

export interface SystemState {
  runningMode: "Sidecar" | "Service";
  isAdminMode: boolean;
  isServiceOk: boolean;
}

const defaultSystemState = {
  runningMode: "Sidecar",
  isAdminMode: false,
  isServiceOk: false,
} as SystemState;

let disablingTunMode = false;

/**
 * 自定义 hook 用于获取系统运行状态
 * 包括运行模式、管理员状态、系统服务是否可用
 */
export function useSystemState() {
  const { verge, patchVerge } = useVerge();

  const {
    data: systemState,
    mutate: mutateSystemState,
    isLoading,
  } = useSWR(
    "getSystemState",
    async () => {
      const [runningMode, isAdminMode, isServiceOk] = await Promise.all([
        getRunningMode(),
        isAdmin(),
        isServiceAvailable(),
      ]);
      return { runningMode, isAdminMode, isServiceOk } as SystemState;
    },
    {
      suspense: true,
      refreshInterval: 30000,
      fallback: defaultSystemState,
    },
  );

  const isSidecarMode = systemState.runningMode === "Sidecar";
  const isServiceMode = systemState.runningMode === "Service";
  const isTunModeAvailable = systemState.isAdminMode || systemState.isServiceOk;

  const enable_tun_mode = verge?.enable_tun_mode;
  useEffect(() => {
    if (enable_tun_mode === undefined) return;

    if (
      !disablingTunMode &&
      enable_tun_mode &&
      !isTunModeAvailable &&
      !isLoading
    ) {
      disablingTunMode = true;
      patchVerge({ enable_tun_mode: false })
        .then(() => {
          showNotice.info(
            "settings.sections.system.notifications.tunMode.autoDisabled",
          );
        })
        .catch((err) => {
          console.error("[useVerge] 自动关闭TUN模式失败:", err);
          showNotice.error(
            "settings.sections.system.notifications.tunMode.autoDisableFailed",
          );
        })
        .finally(() => {
          const tid = setTimeout(() => {
            // 避免 verge 数据更新不及时导致重复执行关闭 Tun 模式
            disablingTunMode = false;
            clearTimeout(tid);
          }, 1000);
        });
    }
  }, [enable_tun_mode, isTunModeAvailable, patchVerge, isLoading]);

  return {
    runningMode: systemState.runningMode,
    isAdminMode: systemState.isAdminMode,
    isServiceOk: systemState.isServiceOk,
    isSidecarMode,
    isServiceMode,
    isTunModeAvailable,
    mutateSystemState,
    isLoading,
  };
}
