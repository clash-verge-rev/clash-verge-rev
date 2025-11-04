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
        "entities.settings.clash.status.stopping",
      );
      await executeWithErrorHandling(
        () => uninstallService(),
        "entities.settings.clash.service.status.uninstalling",
        "entities.settings.clash.service.notifications.uninstallSuccess",
      );
    } catch (ignore) {
    } finally {
      await executeWithErrorHandling(
        () => restartCore(),
        "entities.settings.clash.status.restarting",
        "entities.settings.clash.notifications.restartSuccess",
      );
      await mutateSystemState();
    }
  }, [mutateSystemState]);

  return { uninstallServiceAndRestartCore };
};
