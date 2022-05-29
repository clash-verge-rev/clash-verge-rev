import useSWR, { useSWRConfig } from "swr";
import { useSetRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import {
  ListItemText,
  TextField,
  Switch,
  Select,
  MenuItem,
  Typography,
  Box,
} from "@mui/material";
import { ApiType } from "../../services/types";
import { atomClashPort } from "../../services/states";
import { patchClashConfig } from "../../services/cmds";
import { SettingList, SettingItem } from "./setting";
import { getClashConfig, getVersion, updateConfigs } from "../../services/api";
import Notice from "../base/base-notice";
import GuardState from "./guard-state";
import CoreSwitch from "./core-switch";

interface Props {
  onError: (err: Error) => void;
}

// const MULTI_CORE = !!import.meta.env.VITE_MULTI_CORE;
const MULTI_CORE = true;

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: clashConfig } = useSWR("getClashConfig", getClashConfig);
  const { data: versionData } = useSWR("getVersion", getVersion);

  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "mixed-port": mixedPort,
  } = clashConfig ?? {};

  const setGlobalClashPort = useSetRecoilState(atomClashPort);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<ApiType.ConfigData>) => {
    mutate("getClashConfig", { ...clashConfig, ...patch }, false);
  };
  const onUpdateData = async (patch: Partial<ApiType.ConfigData>) => {
    await updateConfigs(patch);
    await patchClashConfig(patch);
  };

  const onUpdatePort = async (port: number) => {
    if (port < 1000) {
      throw new Error("The port should not < 1000");
    }
    if (port > 65536) {
      throw new Error("The port should not > 65536");
    }
    await patchClashConfig({ "mixed-port": port });
    setGlobalClashPort(port);
    Notice.success("Change Clash port successfully!", 1000);

    // update the config
    mutate("getClashConfig");
  };

  // get clash core version
  const clashVer = versionData?.premium
    ? `${versionData.version} Premium`
    : versionData?.version || "-";

  return (
    <SettingList title={t("Clash Setting")}>
      <SettingItem>
        <ListItemText primary={t("Allow Lan")} />
        <GuardState
          value={allowLan ?? false}
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
        <ListItemText primary={t("IPv6")} />
        <GuardState
          value={ipv6 ?? false}
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
        <ListItemText primary={t("Log Level")} />
        <GuardState
          value={logLevel ?? "info"}
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
        <ListItemText primary={t("Mixed Port")} />
        <GuardState
          value={mixedPort ?? 0}
          onCatch={onError}
          onFormat={(e: any) => +e.target.value?.replace(/\D+/, "")}
          onChange={(e) => onChangeData({ "mixed-port": e })}
          onGuard={onUpdatePort}
          waitTime={1000}
        >
          <TextField autoComplete="off" size="small" sx={{ width: 120 }} />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText
          primary={
            MULTI_CORE ? (
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <span style={{ marginRight: 4 }}>{t("Clash Core")}</span>
                <CoreSwitch />
              </Box>
            ) : (
              t("Clash Core")
            )
          }
        />
        <Typography sx={{ py: 1 }}>{clashVer}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingClash;
