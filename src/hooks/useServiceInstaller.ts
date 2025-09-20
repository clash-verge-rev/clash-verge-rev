import { t } from "i18next";
import { useCallback } from "react";

import { installService, restartCore } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

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

export const useServiceInstaller = () => {
  const installServiceAndRestartCore = useCallback(async () => {
    await executeWithErrorHandling(
      () => installService(),
      "Installing Service...",
      "Service Installed Successfully",
    );

    await executeWithErrorHandling(() => restartCore(), "Restarting Core...");
  }, []);
  return { installServiceAndRestartCore };
};
