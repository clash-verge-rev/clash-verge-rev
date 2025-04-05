import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { portableFlag } from "@/pages/_layout";
import { useSetUpdateState, useUpdateState } from "@/services/states";
import getSystem from "@/utils/get-system";
import { Box, Button, LinearProgress } from "@mui/material";
import { Event, listen, UnlistenFn } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { check } from "@tauri-apps/plugin-updater";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import useSWR from "swr";

const OS = getSystem();

export const UpdateViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  const updateState = useUpdateState();
  const setUpdateState = useSetUpdateState();

  const { data: updateInfo } = useSWR("checkUpdate", check, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  const [downloaded, setDownloaded] = useState(0);
  const [buffer, setBuffer] = useState(0);
  // default 10M
  const [total, setTotal] = useState(10 * 1024 * 1024);

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
      Notice.error(t("Portable Updater Error"));
      return;
    }
    if (!updateInfo?.body) return;
    if (breakChangeFlag) {
      Notice.error(t("Break Change Update Error"));
      return;
    }
    if (updateState) return;
    setUpdateState(true);
    try {
      await updateInfo.downloadAndInstall((e) => {
        console.log(e);
        if (e.event === "Started") setTotal(e.data.contentLength || 100);
        if (e.event === "Progress") {
          const chunkLength = e.data.chunkLength;
          setBuffer(chunkLength);
          setDownloaded((prev) => {
            return prev + chunkLength;
          });
        }
      });
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
          {`New Version v${updateInfo?.version}`}
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                openUrl(
                  `https://github.com/oomeow/clash-verge-self/releases/tag/v${updateInfo?.version}`,
                );
              }}>
              {t("Go to Release Page")}
            </Button>
          </Box>
        </Box>
      }
      contentStyle={{ minWidth: 360, maxWidth: 400 }}
      okBtn={t("Update")}
      cancelBtn={t("Cancel")}
      hideFooter={OS === "linux"}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onUpdate}>
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
          }}>
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
