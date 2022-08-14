import useSWR, { useSWRConfig } from "swr";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton, Switch, TextField } from "@mui/material";
import { ArrowForward, PrivacyTipRounded } from "@mui/icons-material";
import {
  checkService,
  getVergeConfig,
  patchVergeConfig,
} from "@/services/cmds";
import { SettingList, SettingItem } from "./setting";
import getSystem from "@/utils/get-system";
import GuardState from "./mods/guard-state";
import ServiceMode from "./mods/service-mode";
import SysproxyTooltip from "./mods/sysproxy-tooltip";

interface Props {
  onError?: (err: Error) => void;
}

const isWIN = getSystem() === "windows";

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

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
    system_proxy_bypass,
    enable_proxy_guard,
  } = vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutate("getVergeConfig", { ...vergeConfig, ...patch }, false);
  };

  return (
    <SettingList title={t("System Setting")}>
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

      <SettingItem label={t("System Proxy")} extra={<SysproxyTooltip />}>
        <GuardState
          value={enable_system_proxy ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_system_proxy: e })}
          onGuard={async (e) => {
            await patchVergeConfig({ enable_system_proxy: e });
            mutate("getVergeConfig"); // update bypass value
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      {enable_system_proxy && (
        <SettingItem label={t("Proxy Guard")}>
          <GuardState
            value={enable_proxy_guard ?? false}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_proxy_guard: e })}
            onGuard={(e) => patchVergeConfig({ enable_proxy_guard: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </SettingItem>
      )}

      {enable_system_proxy && (
        <SettingItem label={t("Proxy Bypass")}>
          <GuardState
            value={system_proxy_bypass ?? ""}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ system_proxy_bypass: e })}
            onGuard={(e) => patchVergeConfig({ system_proxy_bypass: e })}
            waitTime={1000}
          >
            <TextField
              autoComplete="off"
              size="small"
              sx={{ width: 120, input: { py: "7.5px" } }}
            />
          </GuardState>
        </SettingItem>
      )}
    </SettingList>
  );
};

export default SettingSystem;
