import { useCallback } from "react";

import { installService, restartCore } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

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

export const useServiceInstaller = () => {
  const { mutateSystemState } = useSystemState();

  const installServiceAndRestartCore = useCallback(async () => {
    await executeWithErrorHandling(
      () => installService(),
      "settings.statuses.clashService.installing",
      "settings.feedback.notifications.clashService.installSuccess",
    );

    await executeWithErrorHandling(
      () => restartCore(),
      "settings.statuses.clash.restarting",
      "settings.feedback.notifications.clash.restartSuccess",
    );

    await mutateSystemState();
  }, [mutateSystemState]);
  return { installServiceAndRestartCore };
};
