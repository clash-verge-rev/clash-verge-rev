import useSWR from "swr";
import { getRunningMode, isAdmin } from "@/services/cmds";

/**
 * 自定义 hook 用于获取系统运行状态
 * 包括运行模式和管理员状态
 */
export function useSystemState() {
  // 获取运行模式
  const { data: runningMode = "Sidecar", mutate: mutateRunningMode } = 
    useSWR("getRunningMode", getRunningMode, { 
      suspense: false,
      revalidateOnFocus: false 
    });
  
  // 获取管理员状态
  const { data: isAdminMode = false } = 
    useSWR("isAdmin", isAdmin, { 
      suspense: false,
      revalidateOnFocus: false 
    });
  
  return {
    runningMode,
    isAdminMode,
    isSidecarMode: runningMode === "Sidecar",
    mutateRunningMode
  };
} 