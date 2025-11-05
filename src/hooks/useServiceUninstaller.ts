import { useCallback } from "react";

import { restartCore, stopCore, uninstallService } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

import { useSystemState } from "./use-system-state";

const executeWithErrorHandling = async (
  operation: () => Promise<void>,
  loadingKey: string,
  successKey?: string,
) => {
  try {
    showNotice.info(loadingKey);
    await operation();
    if (successKey) {
      showNotice.success(successKey);
    }
  } catch (err) {
    showNotice.error(err);
    throw err;
  }
};

export const useServiceUninstaller = () => {
  const { mutateSystemState } = useSystemState();

  const uninstallServiceAndRestartCore = useCallback(async () => {
    try {
      await executeWithErrorHandling(
        () => stopCore(),
        "settings.clash.status.stopping",
      );
      await executeWithErrorHandling(
        () => uninstallService(),
        "settings.clash.service.status.uninstalling",
        "settings.clash.service.notifications.uninstallSuccess",
      );
    } catch (ignore) {
    } finally {
      await executeWithErrorHandling(
        () => restartCore(),
        "settings.clash.status.restarting",
        "settings.clash.notifications.restartSuccess",
      );
      await mutateSystemState();
    }
  }, [mutateSystemState]);

  return { uninstallServiceAndRestartCore };
};
