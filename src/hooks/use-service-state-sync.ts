import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";
import { useSystemState } from "@/hooks/use-system-state";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/noticeService";
import { patchVergeConfig } from "@/services/cmds";

/**
 * 专门处理服务状态变化和 TUN Mode 联动的 hook
 * 确保当服务状态改变时，UI 能够立即响应
 */
export function useServiceStateSync() {
  const { t } = useTranslation();
  const { isServiceOk, isTunModeAvailable } = useSystemState();
  const { verge, mutateVerge } = useVerge();
  const { enable_tun_mode } = verge ?? {};

  // 监听服务状态变化，自动处理 TUN Mode
  useEffect(() => {
    // 当服务不可用且TUN模式开启时，自动关闭TUN模式
    if (enable_tun_mode && !isTunModeAvailable) {
      console.log("[useServiceStateSync] 服务不可用，自动关闭TUN模式");

      // 延迟一点时间，确保状态稳定
      const timer = setTimeout(async () => {
        try {
          await patchVergeConfig({ enable_tun_mode: false });
          await mutateVerge();
          showNotice(
            "info",
            t("TUN Mode automatically disabled due to service unavailable"),
          );
        } catch (err) {
          console.error("[useServiceStateSync] 自动关闭TUN模式失败:", err);
          showNotice("error", t("Failed to disable TUN Mode automatically"));
        }
      }, 500); // 500ms 延迟

      return () => clearTimeout(timer);
    }
  }, [enable_tun_mode, isTunModeAvailable, mutateVerge, t]);

  // 强制更新相关缓存的辅助函数
  const forceUpdateServiceState = async (serviceState: boolean) => {
    console.log("[useServiceStateSync] 强制更新服务状态:", serviceState);

    // 立即更新 SWR 缓存
    mutate("isServiceAvailable", serviceState, false);

    // 等待一小段时间让状态传播
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 如果需要，可以添加其他相关状态的更新
    return serviceState;
  };

  return {
    forceUpdateServiceState,
  };
}
