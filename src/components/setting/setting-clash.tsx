import useSWR from "swr";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  TextField,
  Switch,
  Select,
  MenuItem,
  Typography,
  IconButton,
} from "@mui/material";
import { ArrowForward } from "@mui/icons-material";
import { patchClashConfig } from "@/services/cmds";
import { getClashConfig, getVersion, updateConfigs } from "@/services/api";
import { DialogRef } from "@/components/base";
import { GuardState } from "./mods/guard-state";
import { CoreSwitch } from "./mods/core-switch";
import { WebUIViewer } from "./mods/web-ui-viewer";
import { ClashFieldViewer } from "./mods/clash-field-viewer";
import { ClashPortViewer } from "./mods/clash-port-viewer";
import { ControllerViewer } from "./mods/controller-viewer";
import { SettingList, SettingItem } from "./mods/setting-comp";

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

  const webRef = useRef<DialogRef>(null);
  const fieldRef = useRef<DialogRef>(null);
  const portRef = useRef<DialogRef>(null);
  const ctrlRef = useRef<DialogRef>(null);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IConfigData>) => {
    mutateClash((old) => ({ ...(old! || {}), ...patch }), false);
  };
  const onUpdateData = async (patch: Partial<IConfigData>) => {
    await updateConfigs(patch);
    await patchClashConfig(patch);
  };

  // get clash core version
  const clashVer = versionData?.premium
    ? `${versionData.version} Premium`
    : versionData?.version || "-";

  return (
    <SettingList title={t("Clash Setting")}>
      <WebUIViewer ref={webRef} />
      <ClashFieldViewer ref={fieldRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />

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
          // clash premium 2022.08.26 值为warn
          value={logLevel === "warn" ? "warning" : logLevel ?? "info"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ "log-level": e })}
          onGuard={(e) => onUpdateData({ "log-level": e })}
        >
          <Select size="small" sx={{ width: 100, "> div": { py: "7.5px" } }}>
            <MenuItem value="debug">Debug</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Warn</MenuItem>
            <MenuItem value="error">Error</MenuItem>
            <MenuItem value="silent">Silent</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Mixed Port")}>
        <TextField
          autoComplete="off"
          size="small"
          value={mixedPort ?? 0}
          sx={{ width: 100, input: { py: "7.5px", cursor: "pointer" } }}
          onClick={(e) => {
            portRef.current?.open();
            (e.target as any).blur();
          }}
        />
      </SettingItem>

      <SettingItem label={t("External")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => ctrlRef.current?.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Web UI")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => webRef.current?.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Clash Field")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => fieldRef.current?.open()}
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
