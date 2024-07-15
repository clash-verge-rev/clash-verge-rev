import { KeyedMutator } from "swr";
import { useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { installService, uninstallService } from "@/services/cmds";
import { Notice } from "@/components/base";
import { LoadingButton } from "@mui/lab";

interface Props {
  status: "active" | "installed" | "unknown" | "uninstall";
  mutate: KeyedMutator<"active" | "installed" | "unknown" | "uninstall">;
  patchVerge: (value: Partial<IVergeConfig>) => Promise<void>;
  onChangeData: (patch: Partial<IVergeConfig>) => void;
}

export const ServiceSwitcher = (props: Props) => {
  const { status, mutate, patchVerge, onChangeData } = props;

  const isActive = status === "active";
  const isInstalled = status === "installed";
  const isUninstall = status === "uninstall" || status === "unknown";

  const { t } = useTranslation();
  const [serviceLoading, setServiceLoading] = useState(false);
  const [uninstallServiceLoaing, setUninstallServiceLoading] = useState(false);

  const onInstallOrEnableService = useLockFn(async () => {
    setServiceLoading(true);
    try {
      if (isUninstall) {
        // install service
        await installService();
        await mutate();
        setTimeout(() => {
          mutate();
        }, 2000);
        Notice.success(t("Service Installed Successfully"));
        setServiceLoading(false);
      } else {
        // enable or disable service
        await patchVerge({ enable_service_mode: !isActive });
        onChangeData({ enable_service_mode: !isActive });
        await mutate();
        setTimeout(() => {
          mutate();
        }, 2000);
        setServiceLoading(false);
      }
    } catch (err: any) {
      await mutate();
      Notice.error(err.message || err.toString());
      setServiceLoading(false);
    }
  });

  const onUninstallService = useLockFn(async () => {
    setUninstallServiceLoading(true);
    try {
      await uninstallService();
      await mutate();
      setTimeout(() => {
        mutate();
      }, 2000);
      Notice.success(t("Service Uninstalled Successfully"));
      setUninstallServiceLoading(false);
    } catch (err: any) {
      await mutate();
      Notice.error(err.message || err.toString());
      setUninstallServiceLoading(false);
    }
  });

  return (
    <>
      <LoadingButton
        size="small"
        variant={isUninstall ? "outlined" : "contained"}
        onClick={onInstallOrEnableService}
        loading={serviceLoading}
      >
        {isActive ? t("Disable") : isInstalled ? t("Enable") : t("Install")}
      </LoadingButton>
      {isInstalled && (
        <LoadingButton
          size="small"
          variant="outlined"
          color="error"
          sx={{ ml: 1 }}
          onClick={onUninstallService}
          loading={uninstallServiceLoaing}
        >
          {t("Uninstall")}
        </LoadingButton>
      )}
    </>
  );
};
