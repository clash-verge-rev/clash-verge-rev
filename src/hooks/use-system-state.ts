import useSWR from "swr";

import { getRunningMode, isAdmin, isServiceAvailable } from "@/services/cmds";

/**
 * 自定义 hook 用于获取系统运行状态
 * 包括运行模式、管理员状态、系统服务是否可用
 */
export function useSystemState() {
  // 获取运行模式
  const {
    data: runningMode = "Sidecar",
    mutate: mutateRunningMode,
    isLoading: runningModeLoading,
  } = useSWR("getRunningMode", getRunningMode, {
    suspense: false,
    revalidateOnFocus: false,
  });
  const isSidecarMode = runningMode === "Sidecar";
  const isServiceMode = runningMode === "Service";

  // 获取管理员状态
  const { data: isAdminMode = false, isLoading: isAdminLoading } = useSWR(
    "isAdmin",
    isAdmin,
    {
      suspense: false,
      revalidateOnFocus: false,
    },
  );

  const {
    data: isServiceOk = false,
    mutate: mutateServiceOk,
    isLoading: isServiceLoading,
  } = useSWR(isServiceMode ? "isServiceAvailable" : null, isServiceAvailable, {
    suspense: false,
    revalidateOnFocus: false,
    onSuccess: (data) => {
      console.log("[useSystemState] 服务状态更新:", data);
    },
    onError: (error) => {
      console.error("[useSystemState] 服务状态检查失败:", error);
    },
    // isPaused: () => !isServiceMode, // 仅在非 Service 模式下暂停请求
  });

  const isLoading =
    runningModeLoading || isAdminLoading || (isServiceMode && isServiceLoading);

  const isTunModeAvailable = isAdminMode || isServiceOk;

  return {
    runningMode,
    isAdminMode,
    isSidecarMode,
    isServiceMode,
    isServiceOk,
    isTunModeAvailable: isTunModeAvailable,
    mutateRunningMode,
    mutateServiceOk,
    isLoading,
  };
}
