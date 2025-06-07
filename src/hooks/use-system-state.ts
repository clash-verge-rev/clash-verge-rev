import useSWR from "swr";
import { getRunningMode, isAdmin, isServiceAvailable } from "@/services/cmds";

/**
 * 自定义 hook 用于获取系统运行状态
 * 包括运行模式、管理员状态、系统服务是否可用
 */
export function useSystemState() {
  // 获取运行模式
  const { data: runningMode = "Sidecar", mutate: mutateRunningMode } = useSWR(
    "getRunningMode",
    getRunningMode,
    {
      suspense: false,
      revalidateOnFocus: false,
    },
  );

  // 获取管理员状态
  const { data: isAdminMode = false } = useSWR("isAdmin", isAdmin, {
    suspense: false,
    revalidateOnFocus: false,
  });

  // 获取系统服务状态
  const isServiceMode = runningMode === "Service";
  const { data: isServiceOk = false } = useSWR(
    "isServiceAvailable",
    isServiceAvailable,
    {
      suspense: false,
      revalidateOnFocus: false,
      isPaused: () => !isServiceMode, // 仅在 Service 模式下请求
    },
  );

  return {
    runningMode,
    isAdminMode,
    isSidecarMode: runningMode === "Sidecar",
    isServiceMode: runningMode === "Service",
    isServiceOk,
    mutateRunningMode,
  };
}
