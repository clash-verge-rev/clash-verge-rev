import useSWR, { useSWRConfig } from "swr";
import { IconButton, ListItemText, Switch, Typography } from "@mui/material";
import {
  getVergeConfig,
  openAppDir,
  openLogsDir,
  patchVergeConfig,
} from "../../services/cmds";
import { SettingList, SettingItem } from "./setting";
import { CmdType } from "../../services/types";
import { version } from "../../../package.json";
import GuardState from "./guard-state";
import PaletteSwitch from "./palette-switch";
import { ArrowForward } from "@mui/icons-material";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVerge = ({ onError }: Props) => {
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const { theme_mode: mode = "light", theme_blur: blur = false } =
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
        <ListItemText primary="Open App Dir" />
        <IconButton
          color="inherit"
          size="small"
          onClick={() => {
            console.log("click");
            openAppDir().then(console.log).catch(console.log);
          }}
        >
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
