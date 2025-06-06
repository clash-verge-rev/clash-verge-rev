import useSWR from "swr";
import {
  forwardRef,
  useImperativeHandle,
  useState,
  useMemo,
  useEffect,
} from "react";
import { useLockFn } from "ahooks";
import { Box, LinearProgress, Button } from "@mui/material";
import { useTranslation } from "react-i18next";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { BaseDialog, DialogRef } from "@/components/base";
import { useUpdateState, useSetUpdateState } from "@/services/states";
import { Event, UnlistenFn } from "@tauri-apps/api/event";
import { portableFlag } from "@/pages/_layout";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import ReactMarkdown from "react-markdown";
import { useListen } from "@/hooks/use-listen";
import { showNotice } from "@/services/noticeService";

export const UpdateViewer = forwardRef<DialogRef>((props, ref) => {
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
      showNotice("error", t("Portable Updater Error"));
      return;
    }
    if (!updateInfo?.body) return;
    if (breakChangeFlag) {
      showNotice("error", t("Break Change Update Error"));
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
      showNotice("error", err?.message || err.toString());
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
        console.log("UpdateViewer unmounting, cleaning up progress listener.");
        currentProgressListener();
      }
    };
  }, [currentProgressListener]);

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {`New Version v${updateInfo?.version}`}
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
              {t("Go to Release Page")}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{ minWidth: 360, maxWidth: 400, height: "50vh" }}
      okBtn={t("Update")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onUpdate}
    >
      <Box sx={{ height: "calc(100% - 10px)", overflow: "auto" }}>
        <ReactMarkdown
          components={{
            a: ({ node, ...props }) => {
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
});
