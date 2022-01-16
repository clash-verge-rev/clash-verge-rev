import useSWR, { useSWRConfig } from "swr";
import { Box, ListItemText, Switch, Typography } from "@mui/material";
import { getVergeConfig, patchVergeConfig } from "../../services/cmds";
import { SettingList, SettingItem } from "./setting";
import { CmdType } from "../../services/types";
import { version } from "../../../package.json";
import GuardState from "./guard-state";
import PaletteSwitch from "./palette-switch";
import SysproxyTooltip from "./sysproxy-tooltip";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVerge = ({ onError }: Props) => {
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const {
    theme_mode: mode = "light",
    theme_blur: blur = false,
    enable_auto_launch: startup = false,
    enable_system_proxy: proxy = false,
  } = vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutate("getVergeConfig", { ...vergeConfig, ...patch }, false);
  };

  return (
    <SettingList title="Common Setting">
      <SettingItem>
        <ListItemText primary="Theme Mode" />
        <GuardState
          value={mode === "dark"}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ theme_mode: e ? "dark" : "light" })}
          onGuard={(c) =>
            patchVergeConfig({ theme_mode: c ? "dark" : "light" })
          }
        >
          <PaletteSwitch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Theme Blur" />
        <GuardState
          value={blur}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ theme_blur: e })}
          onGuard={(e) => patchVergeConfig({ theme_blur: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Auto Launch" />
        <GuardState
          value={startup}
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
          value={proxy}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_system_proxy: e })}
          onGuard={(e) => patchVergeConfig({ enable_system_proxy: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Version" />
        <Typography sx={{ py: "6px" }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVerge;
