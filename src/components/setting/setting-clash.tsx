import useSWR from "swr";
import { useSetRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import {
  TextField,
  Switch,
  Select,
  MenuItem,
  Typography,
  IconButton,
} from "@mui/material";
import { atomClashPort } from "@/services/states";
import { ArrowForward } from "@mui/icons-material";
import { patchClashConfig } from "@/services/cmds";
import { SettingList, SettingItem } from "./setting";
import { getClashConfig, getVersion, updateConfigs } from "@/services/api";
import useModalHandler from "@/hooks/use-modal-handler";
import Notice from "../base/base-notice";
import GuardState from "./mods/guard-state";
import CoreSwitch from "./mods/core-switch";
import WebUIViewer from "./mods/web-ui-viewer";
import ClashFieldViewer from "./mods/clash-field-viewer";

interface Props {
  onError: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { data: clashConfig, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig
  );
  const { data: versionData } = useSWR("getVersion", getVersion);

  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "mixed-port": mixedPort,
  } = clashConfig ?? {};

  const setGlobalClashPort = useSetRecoilState(atomClashPort);

  const webUIHandler = useModalHandler();
  const fieldHandler = useModalHandler();

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<ApiType.ConfigData>) => {
    mutateClash((old) => ({ ...(old! || {}), ...patch }), false);
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
    mutateClash();
  };

  // get clash core version
  const clashVer = versionData?.premium
    ? `${versionData.version} Premium`
    : versionData?.version || "-";

  return (
    <SettingList title={t("Clash Setting")}>
      <WebUIViewer handler={webUIHandler} onError={onError} />
      <ClashFieldViewer handler={fieldHandler} />

      <SettingItem label={t("Allow Lan")}>
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

      <SettingItem label={t("IPv6")}>
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

      <SettingItem label={t("Log Level")}>
        <GuardState
          value={logLevel ?? "info"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ "log-level": e })}
          onGuard={(e) => onUpdateData({ "log-level": e })}
        >
          <Select size="small" sx={{ width: 120, "> div": { py: "7.5px" } }}>
            <MenuItem value="debug">Debug</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Warning</MenuItem>
            <MenuItem value="error">Error</MenuItem>
            <MenuItem value="silent">Silent</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Mixed Port")}>
        <GuardState
          value={mixedPort ?? 0}
          onCatch={onError}
          onFormat={(e: any) => +e.target.value?.replace(/\D+/, "")}
          onChange={(e) => onChangeData({ "mixed-port": e })}
          onGuard={onUpdatePort}
          waitTime={1000}
        >
          <TextField
            autoComplete="off"
            size="small"
            sx={{ width: 120, input: { py: "7.5px" } }}
          />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Web UI")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => webUIHandler.current.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Clash Field")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => fieldHandler.current.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Clash Core")} extra={<CoreSwitch />}>
        <Typography sx={{ py: "7px" }}>{clashVer}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingClash;
