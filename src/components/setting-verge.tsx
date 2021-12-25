import useSWR, { useSWRConfig } from "swr";
import { List, ListItemText, ListSubheader, Switch } from "@mui/material";
import {
  getVergeConfig,
  patchVergeConfig,
  setSysProxy,
} from "../services/cmds";
import { CmdType } from "../services/types";
import GuardState from "./guard-state";
import SettingItem from "./setting-item";
import PaletteSwitch from "./palette-switch";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVerge = ({ onError }: Props) => {
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const {
    theme_mode: mode = "light",
    enable_self_startup: startup = false,
    enable_system_proxy: proxy = false,
  } = vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;

  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutate("getVergeConfig", { ...vergeConfig, ...patch }, false);
  };

  return (
    <List>
      <ListSubheader>通用设置</ListSubheader>

      <SettingItem>
        <ListItemText primary="外观主题" />
        <GuardState
          value={mode === "dark"}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ theme_mode: e ? "dark" : "light" })}
          onGuard={async (c) => {
            await patchVergeConfig({ theme_mode: c ? "dark" : "light" });
          }}
        >
          <PaletteSwitch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="开机自启" />
        <GuardState
          value={startup}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_self_startup: e })}
          onGuard={async (e) => {
            await patchVergeConfig({ enable_self_startup: e });
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="设置系统代理" />
        <GuardState
          value={proxy}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_system_proxy: e })}
          onGuard={async (e) => {
            await setSysProxy(e);
            await patchVergeConfig({ enable_system_proxy: e });
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>
    </List>
  );
};

export default SettingVerge;
