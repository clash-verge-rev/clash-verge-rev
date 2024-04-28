import useSWR from "swr";
import { forwardRef, useImperativeHandle, useState, useMemo } from "react";
import { useLockFn } from "ahooks";
import { Box, LinearProgress } from "@mui/material";
import { useRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import { relaunch } from "@tauri-apps/api/process";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { atomUpdateState } from "@/services/states";
import { listen, Event, UnlistenFn } from "@tauri-apps/api/event";
import { portableFlag } from "@/pages/_layout";
import ReactMarkdown from "react-markdown";

let eventListener: UnlistenFn | null = null;

export const UpdateViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [updateState, setUpdateState] = useRecoilState(atomUpdateState);

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

  const onUpdate = useLockFn(async () => {
    if (portableFlag) {
      Notice.error(t("Portable Updater Error"));
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
      title={`New Version v${updateInfo?.manifest?.version}`}
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
