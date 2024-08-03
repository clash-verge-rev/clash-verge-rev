import useSWR from "swr";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { SettingsRounded } from "@mui/icons-material";
import { checkService } from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import { DialogRef, Notice, Switch } from "@/components/base";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { GuardState } from "./mods/guard-state";
import { ServiceSwitcher } from "./mods/service-switcher";
import { SysproxyViewer } from "./mods/sysproxy-viewer";
import { TunViewer } from "./mods/tun-viewer";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";

interface Props {
  onError?: (err: Error) => void;
}

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { verge, mutateVerge, patchVerge } = useVerge();
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

  const sysproxyRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);

  const {
    enable_tun_mode,
    enable_auto_launch,
    enable_silent_start,
    enable_system_proxy,
  } = verge ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <SettingList title={t("System Setting")}>
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />

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
              Notice.error(t("Please Enable Service Mode"));
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
        <ServiceSwitcher
          status={serviceStatus ?? "unknown"}
          mutate={mutateServiceStatus}
          patchVerge={patchVerge}
          onChangeData={onChangeData}
        />
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
