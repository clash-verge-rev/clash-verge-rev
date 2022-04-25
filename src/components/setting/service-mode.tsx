import useSWR, { useSWRConfig } from "swr";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import {
  checkService,
  installService,
  uninstallService,
  patchVergeConfig,
} from "../../services/cmds";
import Notice from "../base/base-notice";
import noop from "../../utils/noop";

interface Props {
  open: boolean;
  enable: boolean;
  onClose: () => void;
  onError?: (err: Error) => void;
}

const ServiceMode = (props: Props) => {
  const { open, enable, onClose, onError = noop } = props;

  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: status } = useSWR("checkService", checkService, {
    revalidateIfStale: true,
    shouldRetryOnError: false,
  });

  const state = status != null ? status : "pending";

  const onInstall = useLockFn(async () => {
    try {
      await installService();
      mutate("checkService");
      Notice.success("Service installed successfully");
      onClose();
    } catch (err: any) {
      mutate("checkService");
      onError(err);
    }
  });

  const onUninstall = useLockFn(async () => {
    try {
      if (state === "active" && enable) {
        await patchVergeConfig({ enable_service_mode: false });
      }

      await uninstallService();
      Notice.success("Service uninstalled successfully");
      mutate("checkService");
      onClose();
    } catch (err: any) {
      mutate("checkService");
      onError(err);
    }
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("Service Mode")}</DialogTitle>

      <DialogContent sx={{ width: 360, userSelect: "text" }}>
        <Typography>Current State: {state}</Typography>

        {(state === "unknown" || state === "uninstall") && (
          <Typography>
            Infomation: Please make sure the Clash Verge Service is installed
            and enabled
          </Typography>
        )}

        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 4, justifyContent: "flex-end" }}
        >
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
      </DialogContent>
    </Dialog>
  );
};

export default ServiceMode;
