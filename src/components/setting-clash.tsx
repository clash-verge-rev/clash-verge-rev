import useSWR, { useSWRConfig } from "swr";
import {
  List,
  ListItemText,
  ListSubheader,
  TextField,
  Switch,
  Select,
  MenuItem,
} from "@mui/material";
import { getClashConfig, updateConfigs } from "../services/api";
import { patchClashConfig } from "../services/cmds";
import { ApiType } from "../services/types";
import GuardState from "./guard-state";
import SettingItem from "./setting-item";

interface Props {
  onError?: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { mutate } = useSWRConfig();
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);

  const {
    ipv6 = false,
    "allow-lan": allowLan = false,
    "log-level": logLevel = "silent",
    "mixed-port": mixedPort = 7890,
  } = clashConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;

  const onChangeData = (patch: Partial<ApiType.ConfigData>) => {
    mutate("getClashConfig", { ...clashConfig, ...patch }, false);
  };

  const onUpdateData = async (patch: Partial<ApiType.ConfigData>) => {
    await updateConfigs(patch);
    await patchClashConfig(patch);
  };

  return (
    <List>
      <ListSubheader>Clash设置</ListSubheader>

      <SettingItem>
        <ListItemText primary="局域网连接" />
        <GuardState
          value={allowLan}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ "allow-lan": e })}
          onGuard={(e) => onUpdateData({ "allow-lan": e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="IPv6" />
        <GuardState
          value={ipv6}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ ipv6: e })}
          onGuard={(e) => onUpdateData({ ipv6: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="日志等级" />
        <GuardState
          value={logLevel}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ "log-level": e })}
          onGuard={(e) => onUpdateData({ "log-level": e })}
        >
          <Select size="small" sx={{ width: 120 }}>
            <MenuItem value="debug">Debug</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Warning</MenuItem>
            <MenuItem value="error">Error</MenuItem>
            <MenuItem value="silent">Silent</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="混合代理端口" />
        <TextField
          size="small"
          value={mixedPort!}
          sx={{ width: 120 }}
          disabled
        />
      </SettingItem>
    </List>
  );
};

export default SettingClash;
