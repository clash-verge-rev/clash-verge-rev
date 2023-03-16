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
import { ArrowForward, Settings } from "@mui/icons-material";
import { DialogRef } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { GuardState } from "./mods/guard-state";
import { WebUIViewer } from "./mods/web-ui-viewer";
import { ClashFieldViewer } from "./mods/clash-field-viewer";
import { ClashPortViewer } from "./mods/clash-port-viewer";
import { ControllerViewer } from "./mods/controller-viewer";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { ClashCoreViewer } from "./mods/clash-core-viewer";

interface Props {
  onError: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { clash, version, mutateClash, patchClash } = useClash();

  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "mixed-port": mixedPort,
  } = clash ?? {};

  const webRef = useRef<DialogRef>(null);
  const fieldRef = useRef<DialogRef>(null);
  const portRef = useRef<DialogRef>(null);
  const ctrlRef = useRef<DialogRef>(null);
  const coreRef = useRef<DialogRef>(null);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IConfigData>) => {
    mutateClash((old) => ({ ...(old! || {}), ...patch }), false);
  };

  return (
    <SettingList title={t("Clash Setting")}>
      <WebUIViewer ref={webRef} />
      <ClashFieldViewer ref={fieldRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />
      <ClashCoreViewer ref={coreRef} />

      <SettingItem label={t("Allow Lan")}>
        <GuardState
          value={allowLan ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ "allow-lan": e })}
          onGuard={(e) => patchClash({ "allow-lan": e })}
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
          onGuard={(e) => patchClash({ ipv6: e })}
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
          onGuard={(e) => patchClash({ "log-level": e })}
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

      <SettingItem
        label={t("Clash Core")}
        extra={
          <IconButton
            color="inherit"
            size="small"
            onClick={() => coreRef.current?.open()}
          >
            <Settings
              fontSize="inherit"
              style={{ cursor: "pointer", opacity: 0.75 }}
            />
          </IconButton>
        }
      >
        <Typography sx={{ py: "7px", pr: 1 }}>{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingClash;
