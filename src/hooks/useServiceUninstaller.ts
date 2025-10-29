import { t } from "i18next";
import { useCallback } from "react";

import { restartCore, stopCore, uninstallService } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

import { useSystemState } from "./use-system-state";

const executeWithErrorHandling = async (
  operation: () => Promise<void>,
  loadingMessage: string,
  successMessage?: string,
) => {
  try {
    showNotice("info", t(loadingMessage));
    await operation();
    if (successMessage) {
      showNotice("success", t(successMessage));
    }
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    showNotice("error", msg);
    throw err;
  }
};

export const useServiceUninstaller = () => {
  const { mutateSystemState } = useSystemState();

  const uninstallServiceAndRestartCore = useCallback(async () => {
    try {
      await executeWithErrorHandling(() => stopCore(), "Stopping Core...");
      await executeWithErrorHandling(
        () => uninstallService(),
        "Uninstalling Service...",
        "Service Uninstalled Successfully",
      );
    } catch (ignore) {
    } finally {
      await executeWithErrorHandling(
        () => restartCore(),
        "Restarting Core...",
        "Clash Core Restarted",
      );
      await mutateSystemState();
    }
  }, [mutateSystemState]);

  return { uninstallServiceAndRestartCore };
};
