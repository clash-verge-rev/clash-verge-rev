import { useLockFn } from "ahooks";
import { useEffect } from "foxact/use-abortable-effect";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  applyRecommendedNtpServer,
  checkNtpStatus,
  syncNtpNow,
} from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

const CN_FALLBACK_SERVERS = ["ntp.aliyun.com", "ntp.tencent.com"];
const GLOBAL_FALLBACK_SERVERS = ["time.cloudflare.com", "time.google.com"];

const isCnLikeTimezone = () => {
  const locale =
    typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : "";

  const timezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone?.toLowerCase()
      : undefined;

  if (timezone === "asia/shanghai") {
    return true;
  }

  return locale.startsWith("zh-cn") || locale.startsWith("zh-hans");
};

const getPreferredServer = (status?: INtpStatus | null) => {
  const server = status?.recommendedServers?.[0];
  if (server) return server;
  if (isCnLikeTimezone()) return CN_FALLBACK_SERVERS[0];
  return GLOBAL_FALLBACK_SERVERS[0];
};

export const useNtpChecker = () => {
  const { t } = useTranslation();
  const [promptOpen, setPromptOpen] = useState(false);
  const [status, setStatus] = useState<INtpStatus | null>(null);
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
    server: getPreferredServer(status),
  });

  useEffect(
    (signal) => {
      if (checkedRef.current) return;
      checkedRef.current = true;

      void (async () => {
        try {
          const status = await checkNtpStatus();
          if (signal.aborted) return;

          setStatus(status);
          if (status.enabled) {
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
    },
    [warnManualCalibration],
  );

  const handleApply = useLockFn(async () => {
    try {
      const result = await applyRecommendedNtpServer();
      setStatus(result);
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
