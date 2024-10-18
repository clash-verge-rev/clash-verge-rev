import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useService } from "@/hooks/use-service";
import {
  installService,
  patchVergeConfig,
  uninstallService,
} from "@/services/cmds";
import { Check, Close } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  enable: boolean;
}

export const ServiceViewer = forwardRef<DialogRef, Props>((props, ref) => {
  const { enable } = props;

  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { serviceStatus, mutateCheckService } = useService();

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const state = serviceStatus != null ? serviceStatus : "pending";

  const onInstall = useLockFn(async () => {
    try {
      await installService();
      await mutateCheckService();
      setOpen(false);
      setTimeout(() => {
        mutateCheckService();
      }, 2000);
      Notice.success(t("Service Installed Successfully"));
    } catch (err: any) {
      mutateCheckService();
      Notice.error(err.message || err.toString());
    }
  });

  const onUninstall = useLockFn(async () => {
    try {
      if (enable) {
        await patchVergeConfig({ enable_service_mode: false });
      }

      await uninstallService();
      mutateCheckService();
      setOpen(false);
      Notice.success(t("Service Uninstalled Successfully"));
    } catch (err: any) {
      mutateCheckService();
      Notice.error(err.message || err.toString());
    }
  });

  // fix unhandled error of the service mode
  const onDisable = useLockFn(async () => {
    try {
      await patchVergeConfig({ enable_service_mode: false });
      mutateCheckService();
      setOpen(false);
    } catch (err: any) {
      mutateCheckService();
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Service Mode")}
      contentStyle={{ width: 360, userSelect: "text" }}
      hideFooter
      onClose={() => setOpen(false)}>
      <Box display="flex" flexDirection={"row"} gap={1}>
        {state === "active" || state === "installed" ? (
          <Check color="success" />
        ) : (
          <Close color="error" />
        )}
        <Box>
          <Typography
            sx={{
              "& span": {
                color: state === "active" ? "primary.main" : "text.primary",
              },
            }}>
            {t("Current State")}: {t(state)}
          </Typography>
          {(state === "unknown" || state === "uninstall") && (
            <Typography mt={1} fontSize={14} color={"text.secondary"}>
              {t(
                "Information: Please make sure that the Clash Verge Service is installed and enabled",
              )}
            </Typography>
          )}
        </Box>
      </Box>

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 4, justifyContent: "flex-end" }}>
        {state === "uninstall" && enable && (
          <Button variant="contained" onClick={onDisable}>
            {t("Disable Service Mode")}
          </Button>
        )}

        {state === "uninstall" && (
          <Button variant="contained" onClick={onInstall}>
            {t("Install")}
          </Button>
        )}

        {(state === "active" || state === "installed") && (
          <Button variant="contained" color="error" onClick={onUninstall}>
            {t("Uninstall")}
          </Button>
        )}
      </Stack>
    </BaseDialog>
  );
});
