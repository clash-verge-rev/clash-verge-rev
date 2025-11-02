import { useCallback } from "react";

import { installService, restartCore } from "@/services/cmds";
import { createRawNotice, showNotice } from "@/services/noticeService";

import { useSystemState } from "./use-system-state";

const executeWithErrorHandling = async (
  operation: () => Promise<void>,
  loadingMessage: string,
  successMessage?: string,
) => {
  try {
    showNotice("info", { i18nKey: loadingMessage });
    await operation();
    if (successMessage) {
      showNotice("success", { i18nKey: successMessage });
    }
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    showNotice("error", createRawNotice(msg));
    throw err;
  }
};

export const useServiceInstaller = () => {
  const { mutateSystemState } = useSystemState();

  const installServiceAndRestartCore = useCallback(async () => {
    await executeWithErrorHandling(
      () => installService(),
      "Installing Service...",
      "Service Installed Successfully",
    );

    await executeWithErrorHandling(
      () => restartCore(),
      "Restarting Core...",
      "Clash Core Restarted",
    );

    await mutateSystemState();
  }, [mutateSystemState]);
  return { installServiceAndRestartCore };
};
