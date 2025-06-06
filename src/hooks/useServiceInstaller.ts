import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { showNotice } from "@/services/noticeService";
import {
  installService,
  isServiceAvailable,
  restartCore,
} from "@/services/cmds";
import { useSystemState } from "@/hooks/use-system-state";
import { mutate } from "swr";

export function useServiceInstaller() {
  const { t } = useTranslation();
  const { mutateRunningMode } = useSystemState();

  const installServiceAndRestartCore = useLockFn(async () => {
    try {
      showNotice("info", t("Installing Service..."));
      await installService();
      showNotice("success", t("Service Installed Successfully"));

      showNotice("info", t("Waiting for service to be ready..."));
      let serviceReady = false;
      for (let i = 0; i < 5; i++) {
        try {
          // 等待1秒再检查
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const isAvailable = await isServiceAvailable();
          if (isAvailable) {
            serviceReady = true;
            mutate("isServiceAvailable", true, false);
            break;
          }
          // 最后一次尝试不显示重试信息
          if (i < 4) {
            showNotice(
              "info",
              t("Service not ready, retrying attempt {count}/{total}...", {
                count: i + 1,
                total: 5,
              }),
            );
          }
        } catch (error) {
          console.error(t("Error checking service status:"), error);
          if (i < 4) {
            showNotice(
              "error",
              t(
                "Failed to check service status, retrying attempt {count}/{total}...",
                { count: i + 1, total: 5 },
              ),
            );
          }
        }
      }

      if (!serviceReady) {
        showNotice(
          "info",
          t(
            "Service did not become ready after attempts. Proceeding with core restart.",
          ),
        );
      }

      showNotice("info", t("Restarting Core..."));
      await restartCore();

      // 核心重启后，再次确认并更新相关状态
      await mutateRunningMode();
      const finalServiceStatus = await isServiceAvailable();
      mutate("isServiceAvailable", finalServiceStatus, false);

      if (serviceReady && finalServiceStatus) {
        showNotice("success", t("Service is ready and core restarted"));
      } else if (finalServiceStatus) {
        showNotice("success", t("Core restarted. Service is now available."));
      } else if (serviceReady) {
        showNotice(
          "info",
          t(
            "Service was ready, but core restart might have issues or service became unavailable. Please check.",
          ),
        );
      } else {
        showNotice(
          "error",
          t(
            "Service installation or core restart encountered issues. Service might not be available. Please check system logs.",
          ),
        );
      }
      return finalServiceStatus;
    } catch (err: any) {
      showNotice("error", err.message || err.toString());
      // 尝试性回退或最终操作
      try {
        showNotice("info", t("Attempting to restart core as a fallback..."));
        await restartCore();
        await mutateRunningMode();
        await isServiceAvailable().then((status) =>
          mutate("isServiceAvailable", status, false),
        );
      } catch (recoveryError: any) {
        showNotice(
          "error",
          t("Fallback core restart also failed: {message}", {
            message: recoveryError.message,
          }),
        );
      }
      return false;
    }
  });

  return { installServiceAndRestartCore };
}
