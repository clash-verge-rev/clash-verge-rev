import useSWR, { useSWRConfig } from "swr";
import { IconButton, ListItemText, Switch, Typography } from "@mui/material";
import {
  getVergeConfig,
  openAppDir,
  openLogsDir,
  patchVergeConfig,
} from "../../services/cmds";
import { ArrowForward } from "@mui/icons-material";
import { SettingList, SettingItem } from "./setting";
import { CmdType } from "../../services/types";
import { version } from "../../../package.json";
import PaletteSwitch from "./palette-switch";
import GuardState from "./guard-state";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVerge = ({ onError }: Props) => {
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const { theme_mode = "light", theme_blur = false, traffic_graph } =
    vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutate("getVergeConfig", { ...vergeConfig, ...patch }, false);
  };

  return (
    <SettingList title="Verge Setting">
      <SettingItem>
        <ListItemText primary="Theme Mode" />
        <GuardState
          value={theme_mode === "dark"}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ theme_mode: e ? "dark" : "light" })}
          onGuard={(e) =>
            patchVergeConfig({ theme_mode: e ? "dark" : "light" })
          }
        >
          <PaletteSwitch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Theme Blur" />
        <GuardState
          value={theme_blur}
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
        <ListItemText primary="Traffic Graph" />
        <GuardState
          value={traffic_graph ?? true}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ traffic_graph: e })}
          onGuard={(e) => patchVergeConfig({ traffic_graph: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Open App Dir" />
        <IconButton color="inherit" size="small" onClick={openAppDir}>
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Open Logs Dir" />
        <IconButton color="inherit" size="small" onClick={openLogsDir}>
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Version" />
        <Typography sx={{ py: "6px" }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVerge;
