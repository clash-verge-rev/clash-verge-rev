import useSWR from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Button, Stack, Typography } from "@mui/material";
import {
  checkService,
  installService,
  uninstallService,
  patchVergeConfig,
} from "@/services/cmds";
import { BaseDialog, DialogRef, Notice } from "@/components/base";

interface Props {
  enable: boolean;
}

export const ServiceViewer = forwardRef<DialogRef, Props>((props, ref) => {
  const { enable } = props;

  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { data: status, mutate: mutateCheck } = useSWR(
    "checkService",
    checkService,
    {
      revalidateIfStale: false,
      shouldRetryOnError: false,
      focusThrottleInterval: 36e5, // 1 hour
    }
  );

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const state = status != null ? status : "pending";

  const onInstall = useLockFn(async () => {
    try {
      await installService();
      mutateCheck();
      setOpen(false);
      Notice.success("Service installed successfully");
    } catch (err: any) {
      mutateCheck();
      Notice.error(err.message || err.toString());
    }
  });

  const onUninstall = useLockFn(async () => {
    try {
      if (enable) {
        await patchVergeConfig({ enable_service_mode: false });
      }

      await uninstallService();
      mutateCheck();
      setOpen(false);
      Notice.success("Service uninstalled successfully");
    } catch (err: any) {
      mutateCheck();
      Notice.error(err.message || err.toString());
    }
  });

  // fix unhandled error of the service mode
  const onDisable = useLockFn(async () => {
    try {
      await patchVergeConfig({ enable_service_mode: false });
      mutateCheck();
      setOpen(false);
    } catch (err: any) {
      mutateCheck();
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Service Mode")}
      contentSx={{ width: 360, userSelect: "text" }}
      disableFooter
      onClose={() => setOpen(false)}
    >
      <Typography>Current State: {state}</Typography>

      {(state === "unknown" || state === "uninstall") && (
        <Typography>
          Information: Please make sure that the Clash Verge Service is
          installed and enabled
        </Typography>
      )}

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 4, justifyContent: "flex-end" }}
      >
        {state === "uninstall" && enable && (
          <Button variant="contained" onClick={onDisable}>
            Disable Service Mode
          </Button>
        )}

        {state === "uninstall" && (
          <Button variant="contained" onClick={onInstall}>
            Install
          </Button>
        )}

        {(state === "active" || state === "installed") && (
          <Button variant="outlined" onClick={onUninstall}>
            Uninstall
          </Button>
        )}
      </Stack>
    </BaseDialog>
  );
});
