import { useLockFn } from "ahooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  applyRecommendedNtpServer,
  checkNtpStatus,
  syncNtpNow,
} from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

const getPreferredServer = (status?: INtpStatus | null) => {
  const server = status?.recommendedServers?.[0];
  if (server) return server;
  return "time.cloudflare.com";
};

export const useNtpChecker = () => {
  const { t } = useTranslation();
  const [promptOpen, setPromptOpen] = useState(false);
  const statusRef = useRef<INtpStatus | null>(null);
  const checkedRef = useRef(false);

  const warnManualCalibration = useCallback(() => {
    showNotice.info("layout.ntp.notifications.manualWarning");
  }, []);

  const handleSyncError = useCallback((error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    showNotice.error("layout.ntp.notifications.syncFailed", { message });
  }, []);

  const promptTitle = t("layout.ntp.promptTitle");
  const promptMessage = t("layout.ntp.promptMessage", {
    server: getPreferredServer(statusRef.current),
  });

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    let disposed = false;
    void (async () => {
      try {
        const status = await checkNtpStatus();
        if (disposed) return;

        statusRef.current = status;
        if (status.enabled) {
          await syncNtpNow().catch(handleSyncError);
          return;
        }

        if (status.canConfigure) {
          setPromptOpen(true);
        } else {
          if (status.message) {
            showNotice.info(status.message);
          }
          showNotice.info("layout.ntp.notifications.statusUnknown");
          warnManualCalibration();
        }
      } catch (error) {
        console.error("[NTP] Failed to check status:", error);
        showNotice.info("layout.ntp.notifications.statusUnknown");
        warnManualCalibration();
      }
    })();

    return () => {
      disposed = true;
    };
  }, [handleSyncError, warnManualCalibration]);

  const handleApply = useLockFn(async () => {
    try {
      const result = await applyRecommendedNtpServer();
      statusRef.current = result;
      setPromptOpen(false);

      const server = result.server ?? getPreferredServer(result);
      showNotice.success("layout.ntp.notifications.applySuccess", { server });

      if (!result.enabled) {
        warnManualCalibration();
        return;
      }

      await syncNtpNow().catch(handleSyncError);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      showNotice.error("layout.ntp.notifications.applyFailed", { message });
      setPromptOpen(false);
      warnManualCalibration();
    }
  });

  const handleDecline = useLockFn(async () => {
    setPromptOpen(false);
    warnManualCalibration();
  });

  return {
    promptOpen,
    promptTitle,
    promptMessage,
    handleApply,
    handleDecline,
  };
};
