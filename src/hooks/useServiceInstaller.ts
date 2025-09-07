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
  const { mutateRunningMode, mutateServiceOk } = useSystemState();

  const installServiceAndRestartCore = useLockFn(async () => {
    try {
      // Install service
      showNotice("info", t("Installing Service..."));
      await installService();
      showNotice("success", t("Service Installed Successfully"));

      // Wait for service to be ready
      const serviceReady = await waitForService();

      // 如果服务准备就绪，立即更新状态
      if (serviceReady) {
        mutate("isServiceAvailable", true, false);
      }

      // Restart core
      showNotice("info", t("Restarting Core..."));
      await restartCore();
      await mutateRunningMode();

      // Update final status
      const finalServiceStatus = await updateServiceStatus();
      showFinalStatus(serviceReady, finalServiceStatus);

      return finalServiceStatus;
    } catch (err: any) {
      showNotice("error", err.message || err.toString());
      return await handleRecovery();
    }
  });

  const waitForService = async (): Promise<boolean> => {
    showNotice("info", t("Waiting for service to be ready..."));

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        if (await isServiceAvailable()) {
          mutate("isServiceAvailable", true, false);
          return true;
        }
      } catch (error) {
        console.error(t("Error checking service status:"), error);
      }

      if (i < 5) {
        showNotice(
          "info",
          t("Service not ready, retrying attempt {count}/{total}...", {
            count: i + 1,
            total: 5,
          }),
        );
      }
    }

    showNotice(
      "info",
      t(
        "Service did not become ready after attempts. Proceeding with core restart.",
      ),
    );
    return false;
  };

  const updateServiceStatus = async (): Promise<boolean> => {
    const status = await isServiceAvailable();
    mutate("isServiceAvailable", status, false);
    return status;
  };

  const showFinalStatus = (serviceReady: boolean, finalStatus: boolean) => {
    if (serviceReady && finalStatus) {
      showNotice("success", t("Service is ready and core restarted"));
    } else if (finalStatus) {
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
  };

  const handleRecovery = async (): Promise<boolean> => {
    try {
      showNotice("info", t("Attempting to restart core as a fallback..."));
      await restartCore();
      await mutateRunningMode();
      await mutateServiceOk();
      return await updateServiceStatus();
    } catch (recoveryError: any) {
      showNotice(
        "error",
        t("Fallback core restart also failed: {message}", {
          message: recoveryError.message,
        }),
      );
      return false;
    }
  };

  return { installServiceAndRestartCore };
}
