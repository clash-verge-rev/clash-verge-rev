import useSWR, { useSWRConfig } from "swr";
import { useTranslation } from "react-i18next";
import { Box, ListItemText, Switch, TextField } from "@mui/material";
import { getVergeConfig, patchVergeConfig } from "../../services/cmds";
import { SettingList, SettingItem } from "./setting";
import { CmdType } from "../../services/types";
import GuardState from "./guard-state";
import SysproxyTooltip from "./sysproxy-tooltip";

interface Props {
  onError?: (err: Error) => void;
}

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const {
    enable_tun_mode,
    enable_auto_launch,
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
      <SettingItem>
        <ListItemText primary={t("Tun Mode")} />
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

      <SettingItem>
        <ListItemText primary={t("Auto Launch")} />
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

      <SettingItem>
        <ListItemText primary={t("Silent Start")} />
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

      <SettingItem>
        <ListItemText
          primary={
            <Box sx={{ display: "flex", alignItems: "center" }}>
              {t("System Proxy")}
              <SysproxyTooltip />
            </Box>
          }
        />
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
        <SettingItem>
          <ListItemText primary={t("Proxy Guard")} />
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
        <SettingItem>
          <ListItemText primary={t("Proxy Bypass")} />
          <GuardState
            value={system_proxy_bypass ?? ""}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ system_proxy_bypass: e })}
            onGuard={(e) => patchVergeConfig({ system_proxy_bypass: e })}
            waitTime={1000}
          >
            <TextField autoComplete="off" size="small" sx={{ width: 120 }} />
          </GuardState>
        </SettingItem>
      )}
    </SettingList>
  );
};

export default SettingSystem;
