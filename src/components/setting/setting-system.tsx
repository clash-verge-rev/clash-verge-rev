import useSWR from "swr";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton, Switch } from "@mui/material";
import { ArrowForward, PrivacyTipRounded, Settings } from "@mui/icons-material";
import {
  checkService,
  getVergeConfig,
  patchVergeConfig,
} from "@/services/cmds";
import { SettingList, SettingItem } from "./setting";
import useModalHandler from "@/hooks/use-modal-handler";
import getSystem from "@/utils/get-system";
import GuardState from "./mods/guard-state";
import ServiceMode from "./mods/service-mode";
import SysproxyViewer from "./mods/sysproxy-viewer";

interface Props {
  onError?: (err: Error) => void;
}

const isWIN = getSystem() === "windows";

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { data: vergeConfig, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    getVergeConfig
  );

  // service mode
  const [serviceOpen, setServiceOpen] = useState(false);
  const { data: serviceStatus } = useSWR(
    isWIN ? "checkService" : null,
    checkService,
    { revalidateIfStale: true, shouldRetryOnError: false }
  );

  const {
    enable_tun_mode,
    enable_auto_launch,
    enable_service_mode,
    enable_silent_start,
    enable_system_proxy,
  } = vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutateVerge({ ...vergeConfig, ...patch }, false);
  };

  const sysproxyHandler = useModalHandler();

  return (
    <SettingList title={t("System Setting")}>
      <SysproxyViewer handler={sysproxyHandler} />

      <SettingItem label={t("Tun Mode")}>
        <GuardState
          value={enable_tun_mode ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_tun_mode: e })}
          onGuard={(e) => patchVergeConfig({ enable_tun_mode: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      {isWIN && (
        <SettingItem
          label={t("Service Mode")}
          extra={
            (serviceStatus === "active" || serviceStatus === "installed") && (
              <PrivacyTipRounded
                fontSize="small"
                style={{ cursor: "pointer", opacity: 0.75 }}
                onClick={() => setServiceOpen(true)}
              />
            )
          }
        >
          {serviceStatus === "active" || serviceStatus === "installed" ? (
            <GuardState
              value={enable_service_mode ?? false}
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={(e) => onChangeData({ enable_service_mode: e })}
              onGuard={(e) => patchVergeConfig({ enable_service_mode: e })}
            >
              <Switch edge="end" />
            </GuardState>
          ) : (
            <IconButton
              color="inherit"
              size="small"
              sx={{ my: "2px" }}
              onClick={() => setServiceOpen(true)}
            >
              <ArrowForward />
            </IconButton>
          )}
        </SettingItem>
      )}

      {isWIN && (
        <ServiceMode
          open={serviceOpen}
          enable={!!enable_service_mode}
          onError={onError}
          onClose={() => setServiceOpen(false)}
        />
      )}

      <SettingItem
        label={t("System Proxy")}
        extra={
          <Settings
            fontSize="small"
            style={{ cursor: "pointer", opacity: 0.75 }}
            onClick={() => sysproxyHandler.current.open()}
          />
        }
      >
        <GuardState
          value={enable_system_proxy ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_system_proxy: e })}
          onGuard={async (e) => {
            await patchVergeConfig({ enable_system_proxy: e });
            mutateVerge(); // update bypass value
          }}
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
          onGuard={(e) => patchVergeConfig({ enable_auto_launch: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Silent Start")}>
        <GuardState
          value={enable_silent_start ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_silent_start: e })}
          onGuard={(e) => patchVergeConfig({ enable_silent_start: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>
    </SettingList>
  );
};

export default SettingSystem;
