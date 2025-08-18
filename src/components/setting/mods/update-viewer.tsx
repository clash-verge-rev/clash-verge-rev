import { BaseDialog, DialogRef } from "@/components/base";
import { useNotice } from "@/components/base/notifice";
import { useWindowSize } from "@/hooks/use-window-size";
import { portableFlag } from "@/pages/_layout";
import {
  useSetUpdateState,
  useThemeMode,
  useUpdateState,
} from "@/services/states";
import getSystem from "@/utils/get-system";
import { Box, Button, LinearProgress } from "@mui/material";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { check } from "@tauri-apps/plugin-updater";
import MarkdownPreview from "@uiw/react-markdown-preview";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

const OS = getSystem();

export const UpdateViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { notice } = useNotice();
  const themeMode = useThemeMode();
  const [open, setOpen] = useState(false);
  const updateState = useUpdateState();
  const setUpdateState = useSetUpdateState();
  const { size } = useWindowSize();

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
      notice("error", t("Portable Updater Error"));
      return;
    }
    if (!updateInfo?.body) return;
    if (breakChangeFlag) {
      notice("error", t("Break Change Update Error"));
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
      notice("error", err?.message || err.toString());
    } finally {
      setUpdateState(false);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <div className="flex justify-between">
          Clash Verge Self v{updateInfo?.version}
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
        </div>
      }
      contentStyle={{ minWidth: 360, maxWidth: "60%" }}
      okBtn={t("Update")}
      cancelBtn={t("Cancel")}
      hideFooter={OS === "linux"}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onUpdate}>
      <div style={{ maxHeight: size.height - 260, overflow: "auto" }}>
        <MarkdownPreview
          className="p-4"
          source={markdownContent}
          wrapperElement={{ "data-color-mode": themeMode }}
          components={{
            a: ({ node, ...props }) => {
              const { children } = props;
              if (props.className === "anchor") return null;
              return (
                <a {...props} target="_blank">
                  {children}
                </a>
              );
            },
          }}
        />
      </div>
      <LinearProgress
        variant="buffer"
        value={(downloaded / total) * 100}
        valueBuffer={buffer}
        sx={{ marginTop: "10px", opacity: updateState ? 1 : 0 }}
      />
    </BaseDialog>
  );
});
