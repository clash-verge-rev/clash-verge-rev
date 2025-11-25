import { Box, Button, LinearProgress } from "@mui/material";
import { Event, UnlistenFn } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useLockFn } from "ahooks";
import type { Ref } from "react";
import { useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import useSWR from "swr";

import { BaseDialog, DialogRef } from "@/components/base";
import { useListen } from "@/hooks/use-listen";
import { portableFlag } from "@/pages/_layout";
import { showNotice } from "@/services/noticeService";
import { useSetUpdateState, useUpdateState } from "@/services/states";
import { checkUpdateSafe as checkUpdate } from "@/services/update";
import { debugLog } from "@/utils/debug";

export function UpdateViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [currentProgressListener, setCurrentProgressListener] =
    useState<UnlistenFn | null>(null);

  const updateState = useUpdateState();
  const setUpdateState = useSetUpdateState();
  const { addListener } = useListen();

  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  const [downloaded, setDownloaded] = useState(0);
  const [buffer, setBuffer] = useState(0);
  const [total, setTotal] = useState(0);

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

    if (currentProgressListener) {
      currentProgressListener();
    }

    const progressListener = await addListener(
      "tauri://update-download-progress",
      (e: Event<any>) => {
        setTotal(e.payload.contentLength);
        setBuffer(e.payload.chunkLength);
        setDownloaded((a) => {
          return a + e.payload.chunkLength;
        });
      },
    );
    setCurrentProgressListener(() => progressListener);

    try {
      await updateInfo.downloadAndInstall();
      await relaunch();
    } catch (err: any) {
      showNotice.error(err);
    } finally {
      setUpdateState(false);
      if (progressListener) {
        progressListener();
      }
      setCurrentProgressListener(null);
    }
  });

  useEffect(() => {
    return () => {
      if (currentProgressListener) {
        debugLog("UpdateViewer unmounting, cleaning up progress listener.");
        currentProgressListener();
      }
    };
  }, [currentProgressListener]);

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
          variant="buffer"
          value={(downloaded / total) * 100}
          valueBuffer={buffer}
          sx={{ marginTop: "5px" }}
        />
      )}
    </BaseDialog>
  );
}
