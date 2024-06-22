import useSWR from "swr";
import { forwardRef, useImperativeHandle, useState, useMemo } from "react";
import { useLockFn } from "ahooks";
import { Box, LinearProgress, Button } from "@mui/material";
import { useTranslation } from "react-i18next";
import { relaunch } from "@tauri-apps/api/process";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useUpdateState, useSetUpdateState } from "@/services/states";
import { listen, Event, UnlistenFn } from "@tauri-apps/api/event";
import { portableFlag } from "@/pages/_layout";
import { open as openUrl } from "@tauri-apps/api/shell";
import ReactMarkdown from "react-markdown";

let eventListener: UnlistenFn | null = null;

export const UpdateViewer = forwardRef<DialogRef>((props, ref) => {
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
  const [buffer, setBuffer] = useState(0);
  const [total, setTotal] = useState(0);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const markdownContent = useMemo(() => {
    if (!updateInfo?.manifest?.body) {
      return "New Version is available";
    }
    return updateInfo?.manifest?.body;
  }, [updateInfo]);

  const breakChangeFlag = useMemo(() => {
    if (!updateInfo?.manifest?.body) {
      return false;
    }
    return updateInfo?.manifest?.body.toLowerCase().includes("break change");
  }, [updateInfo]);

  const onUpdate = useLockFn(async () => {
    if (portableFlag) {
      Notice.error(t("Portable Updater Error"));
      return;
    }
    if (!updateInfo?.manifest?.body) return;
    if (breakChangeFlag) {
      Notice.error(t("Break Change Update Error"));
      return;
    }
    if (updateState) return;
    setUpdateState(true);
    if (eventListener !== null) {
      eventListener();
    }
    eventListener = await listen(
      "tauri://update-download-progress",
      (e: Event<any>) => {
        setTotal(e.payload.contentLength);
        setBuffer(e.payload.chunkLength);
        setDownloaded((a) => {
          return a + e.payload.chunkLength;
        });
      }
    );
    try {
      await installUpdate();
      await relaunch();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      setUpdateState(false);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {`New Version v${updateInfo?.manifest?.version}`}
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                openUrl(
                  `https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v${updateInfo?.manifest?.version}`
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
