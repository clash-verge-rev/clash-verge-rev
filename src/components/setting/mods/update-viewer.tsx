import { Box, Button, LinearProgress } from "@mui/material";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { useLockFn } from "ahooks";
import type { Ref } from "react";
import { useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import useSWR from "swr";

import { BaseDialog, DialogRef } from "@/components/base";
import { portableFlag } from "@/pages/_layout";
import { showNotice } from "@/services/notice-service";
import { useSetUpdateState, useUpdateState } from "@/services/states";
import { checkUpdateSafe as checkUpdate } from "@/services/update";

export function UpdateViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const updateState = useUpdateState();
  const setUpdateState = useSetUpdateState();

  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const downloadedRef = useRef(0);
  const totalRef = useRef(0);

  const progress = useMemo(() => {
    if (total <= 0) return 0;
    return Math.min((downloaded / total) * 100, 100);
  }, [downloaded, total]);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const markdownContent = useMemo(() => {
    if (!updateInfo?.body) {
      return "New Version is available";
    }
    return updateInfo?.body;
  }, [updateInfo]);

  const breakChangeFlag = useMemo(() => {
    if (!updateInfo?.body) {
      return false;
    }
    return updateInfo?.body.toLowerCase().includes("break change");
  }, [updateInfo]);

  const onUpdate = useLockFn(async () => {
    if (portableFlag) {
      showNotice.error("settings.modals.update.messages.portableError");
      return;
    }
    if (!updateInfo?.body) return;
    if (breakChangeFlag) {
      showNotice.error("settings.modals.update.messages.breakChangeError");
      return;
    }
    if (updateState) return;
    setUpdateState(true);
    setDownloaded(0);
    setTotal(0);
    downloadedRef.current = 0;
    totalRef.current = 0;

    const onDownloadEvent = (event: DownloadEvent) => {
      if (event.event === "Started") {
        const contentLength = event.data.contentLength ?? 0;
        totalRef.current = contentLength;
        setTotal(contentLength);
        setDownloaded(0);
        downloadedRef.current = 0;
        return;
      }

      if (event.event === "Progress") {
        setDownloaded((prev) => {
          const next = prev + event.data.chunkLength;
          downloadedRef.current = next;
          return next;
        });
      }

      if (event.event === "Finished" && totalRef.current === 0) {
        totalRef.current = downloadedRef.current;
        setTotal(downloadedRef.current);
      }
    };

    try {
      await updateInfo.downloadAndInstall(onDownloadEvent);
      await relaunch();
    } catch (err: any) {
      showNotice.error(err);
    } finally {
      setUpdateState(false);
      setDownloaded(0);
      setTotal(0);
      downloadedRef.current = 0;
      totalRef.current = 0;
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("settings.modals.update.title", {
            version: updateInfo?.version ?? "",
          })}
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                openUrl(
                  `https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v${updateInfo?.version}`,
                );
              }}
            >
              {t("settings.modals.update.actions.goToRelease")}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{ minWidth: 360, maxWidth: 400, height: "50vh" }}
      okBtn={t("settings.modals.update.actions.update")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onUpdate}
    >
      <Box sx={{ height: "calc(100% - 10px)", overflow: "auto" }}>
        <ReactMarkdown
          components={{
            a: ({ ...props }) => {
              const { children } = props;
              return (
                <a {...props} target="_blank">
                  {children}
                </a>
              );
            },
          }}
        >
          {markdownContent}
        </ReactMarkdown>
      </Box>
      {updateState && (
        <LinearProgress
          variant={total > 0 ? "determinate" : "indeterminate"}
          value={progress}
          sx={{ marginTop: "5px" }}
        />
      )}
    </BaseDialog>
  );
}
