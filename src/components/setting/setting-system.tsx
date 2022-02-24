import useSWR, { useSWRConfig } from "swr";
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
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const {
    enable_auto_launch = false,
    enable_system_proxy = false,
    system_proxy_bypass = "",
    enable_proxy_guard = false,
  } = vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutate("getVergeConfig", { ...vergeConfig, ...patch }, false);
  };

  return (
    <SettingList title="System Setting">
      <SettingItem>
        <ListItemText primary="Auto Launch" />
        <GuardState
          value={enable_auto_launch}
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
        <ListItemText
          primary={
            <Box sx={{ display: "flex", alignItems: "center" }}>
              System Proxy
              <SysproxyTooltip />
            </Box>
          }
        />
        <GuardState
          value={enable_system_proxy}
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
          <ListItemText primary="Proxy Guard" />
          <GuardState
            value={enable_proxy_guard}
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
          <ListItemText primary="Proxy Bypass" />
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
