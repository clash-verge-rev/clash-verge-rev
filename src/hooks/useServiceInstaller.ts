import { t } from "i18next";
import { useCallback } from "react";

import {
  getRunningMode,
  installService,
  isServiceAvailable,
  restartCore,
} from "@/services/cmds";
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

export const useServiceInstaller = () => {
  const { mutateRunningMode, mutateServiceOk } = useSystemState();

  const installServiceAndRestartCore = useCallback(async () => {
    await executeWithErrorHandling(
      () => installService(),
      "Installing Service...",
      "Service Installed Successfully",
    );

    await executeWithErrorHandling(() => restartCore(), "Restarting Core...");

    // Refresh cached running mode and service availability after a successful restart
    const nextMode = await getRunningMode().catch(() => undefined);
    if (nextMode) {
      await mutateRunningMode(nextMode, { revalidate: false }).catch(
        () => undefined,
      );
    }
    await mutateRunningMode().catch(() => undefined);

    if (nextMode === "Service") {
      const available = await isServiceAvailable().catch(() => false);
      await mutateServiceOk(available, { revalidate: false }).catch(
        () => undefined,
      );
      await mutateServiceOk().catch(() => undefined);
    } else {
      await mutateServiceOk(false, { revalidate: false }).catch(
        () => undefined,
      );
    }
  }, [mutateRunningMode, mutateServiceOk]);
  return { installServiceAndRestartCore };
};
