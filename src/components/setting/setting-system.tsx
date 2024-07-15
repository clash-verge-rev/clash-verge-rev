import useSWR from "swr";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsRounded } from "@mui/icons-material";
import {
  checkService,
  installService,
  uninstallService,
} from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import { DialogRef, Notice, Switch } from "@/components/base";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { GuardState } from "./mods/guard-state";
import { ServiceViewer } from "./mods/service-viewer";
import { SysproxyViewer } from "./mods/sysproxy-viewer";
import { TunViewer } from "./mods/tun-viewer";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { LoadingButton } from "@mui/lab";
import { useLockFn } from "ahooks";

interface Props {
  onError?: (err: Error) => void;
}

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { verge, mutateVerge, patchVerge } = useVerge();
  const [serviceLoading, setServiceLoading] = useState(false);
  const [uninstallServiceLoaing, setUninstallServiceLoading] = useState(false);
  // service mode
  const { data: serviceStatus, mutate: mutateServiceStatus } = useSWR(
    "checkService",
    checkService,
    {
      revalidateIfStale: false,
      shouldRetryOnError: false,
      focusThrottleInterval: 36e5, // 1 hour
    }
  );

  const serviceRef = useRef<DialogRef>(null);
  const sysproxyRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);

  const {
    enable_tun_mode,
    enable_auto_launch,
    enable_service_mode,
    enable_silent_start,
    enable_system_proxy,
  } = verge ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  const onInstallOrEnableService = useLockFn(async () => {
    setServiceLoading(true);
    try {
      if (serviceStatus === "uninstall" || serviceStatus === "unknown") {
        // install service
        await installService();
        await mutateServiceStatus();
        setTimeout(() => {
          mutateServiceStatus();
        }, 2000);
        Notice.success(t("Service Installed Successfully"));
        setServiceLoading(false);
      } else {
        // enable or disable service
        const enable = serviceStatus === "active";
        await patchVerge({ enable_service_mode: !enable });
        onChangeData({ enable_service_mode: !enable });
        await mutateServiceStatus();
        setTimeout(() => {
          mutateServiceStatus();
        }, 2000);
        setServiceLoading(false);
      }
    } catch (err: any) {
      await mutateServiceStatus();
      Notice.error(err.message || err.toString());
      setServiceLoading(false);
    }
  });

  const onUninstallService = useLockFn(async () => {
    setUninstallServiceLoading(true);
    try {
      await uninstallService();
      await mutateServiceStatus();
      setTimeout(() => {
        mutateServiceStatus();
      }, 2000);
      Notice.success(t("Service Uninstalled Successfully"));
      setUninstallServiceLoading(false);
    } catch (err: any) {
      await mutateServiceStatus();
      Notice.error(err.message || err.toString());
      setUninstallServiceLoading(false);
    }
  });

  return (
    <SettingList title={t("System Setting")}>
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />
      <ServiceViewer ref={serviceRef} enable={!!enable_service_mode} />

      <SettingItem
        label={t("Tun Mode")}
        extra={
          <TooltipIcon
            title={t("Tun Mode Info")}
            icon={SettingsRounded}
            onClick={() => tunRef.current?.open()}
          />
        }
      >
        <GuardState
          value={enable_tun_mode ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => {
            if (serviceStatus !== "active") {
              onChangeData({ enable_tun_mode: false });
            } else {
              onChangeData({ enable_tun_mode: e });
            }
          }}
          onGuard={(e) => {
            if (serviceStatus !== "active" && e) {
              Notice.error(t("Please enable service mode first"));
              return Promise.resolve();
            } else {
              return patchVerge({ enable_tun_mode: e });
            }
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Service Mode")}>
        <LoadingButton
          size="small"
          variant="contained"
          sx={{ mr: serviceStatus !== "installed" ? -1 : 0 }}
          onClick={onInstallOrEnableService}
          loading={serviceLoading}
        >
          {serviceStatus === "active"
            ? t("Disable")
            : serviceStatus === "installed"
            ? t("Enable")
            : t("Install")}
        </LoadingButton>
        {serviceStatus === "installed" && (
          <LoadingButton
            size="small"
            variant="outlined"
            color="error"
            sx={{ ml: 1, mr: -1 }}
            onClick={onUninstallService}
            loading={uninstallServiceLoaing}
          >
            {t("Uninstall")}
          </LoadingButton>
        )}
      </SettingItem>

      <SettingItem
        label={t("System Proxy")}
        extra={
          <>
            <TooltipIcon
              title={t("System Proxy Info")}
              icon={SettingsRounded}
              onClick={() => sysproxyRef.current?.open()}
            />
          </>
        }
      >
        <GuardState
          value={enable_system_proxy ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_system_proxy: e })}
          onGuard={(e) => patchVerge({ enable_system_proxy: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Auto Launch")}>
        <GuardState
          value={enable_auto_launch ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_auto_launch: e })}
          onGuard={(e) => patchVerge({ enable_auto_launch: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Silent Start")}
        extra={<TooltipIcon title={t("Silent Start Info")} />}
      >
        <GuardState
          value={enable_silent_start ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_silent_start: e })}
          onGuard={(e) => patchVerge({ enable_silent_start: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>
    </SettingList>
  );
};

export default SettingSystem;
