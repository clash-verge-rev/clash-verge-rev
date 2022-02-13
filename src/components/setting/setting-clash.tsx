import { useEffect, useState } from "react";
import { useDebounceFn } from "ahooks";
import { useSetRecoilState } from "recoil";
import useSWR, { useSWRConfig } from "swr";
import {
  ListItemText,
  TextField,
  Switch,
  Select,
  MenuItem,
  Typography,
} from "@mui/material";
import { ApiType } from "../../services/types";
import { atomClashPort } from "../../states/setting";
import { patchClashConfig } from "../../services/cmds";
import { SettingList, SettingItem } from "./setting";
import { getClashConfig, getVersion, updateConfigs } from "../../services/api";
import Notice from "../base/base-notice";
import GuardState from "./guard-state";

interface Props {
  onError: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { mutate } = useSWRConfig();
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);

  const {
    ipv6 = false,
    "allow-lan": allowLan = false,
    "log-level": logLevel = "silent",
    "mixed-port": thePort = 0,
  } = clashConfig ?? {};

  const setPort = useSetRecoilState(atomClashPort);
  const [mixedPort, setMixedPort] = useState(thePort);

  useEffect(() => setMixedPort(thePort), [thePort]);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<ApiType.ConfigData>) => {
    mutate("getClashConfig", { ...clashConfig, ...patch }, false);
  };
  const onUpdateData = async (patch: Partial<ApiType.ConfigData>) => {
    await updateConfigs(patch);
    await patchClashConfig(patch);
  };

  // restart clash when port is changed
  const { run: onUpdatePort } = useDebounceFn(
    async (port: number) => {
      try {
        if (port < 1000) {
          throw new Error("The port should not < 1000");
        }
        if (port > 65536) {
          throw new Error("The port should not > 65536");
        }
        await patchClashConfig({ "mixed-port": port });
        onChangeData({ "mixed-port": port });
        setPort(port);
        Notice.success("Change Clash port successfully!");
      } catch (err: any) {
        setMixedPort(thePort); // back to old port value
        Notice.error(err.message ?? err.toString());
      }
    },
    { wait: 1000 }
  );

  // get clash core version
  const [clashVer, setClashVer] = useState("");
  useEffect(() => {
    getVersion().then(({ premium, version }) => {
      setClashVer(premium ? `${version} Premium` : version);
    });
  }, []);

  return (
    <SettingList title="Clash Setting">
      <SettingItem>
        <ListItemText primary="Allow Lan" />
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
        <ListItemText primary="Log Level" />
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
        <ListItemText primary="Mixed Port" />
        <GuardState
          value={mixedPort!}
          onFormat={(e: any) => +e.target.value?.replace(/\D+/, "")}
          onChange={setMixedPort}
          onGuard={onUpdatePort}
        >
          <TextField autoComplete="off" size="small" sx={{ width: 120 }} />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary="Clash core" />
        <Typography sx={{ py: 1 }}>{clashVer}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingClash;
