import { DialogRef, Notice, SwitchLovely } from "@/components/base";
import { ServiceViewer } from "@/components/setting/mods/service-viewer";
import { TunViewer } from "@/components/setting/mods/tun-viewer";
import { useClash } from "@/hooks/use-clash";
import { useService } from "@/hooks/use-service";
import { useVerge } from "@/hooks/use-verge";
import { invoke_uwp_tool } from "@/services/cmds";
import { useClashLog } from "@/services/states";
import getSystem from "@/utils/get-system";
import {
  InfoRounded,
  PrivacyTipRounded,
  Settings,
  Shuffle,
} from "@mui/icons-material";
import {
  IconButton,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cleanFakeIp, updateGeo } from "tauri-plugin-mihomo-api";
import { ClashCoreViewer } from "./mods/clash-core-viewer";
import { ClashPortViewer } from "./mods/clash-port-viewer";
import { ControllerViewer } from "./mods/controller-viewer";
import { GuardState } from "./mods/guard-state";
import { SettingItem, SettingList } from "./mods/setting-comp";
import { WebUIViewer } from "./mods/web-ui-viewer";

const isWIN = getSystem() === "windows";

interface Props {
  onError: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { clash, version, patchClash } = useClash();
  const { verge, mutateVerge, patchVerge } = useVerge();
  const { serviceStatus, mutateCheckService } = useService();

  useEffect(() => {
    if (!verge) return;

    mutateCheckService();
  }, [verge]);

  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "unified-delay": UnifiedDelay,
    tun,
  } = clash ?? {};
  const { enable_random_port = false, enable_service_mode } = verge ?? {};

  const webRef = useRef<DialogRef>(null);
  const portRef = useRef<DialogRef>(null);
  const ctrlRef = useRef<DialogRef>(null);
  const coreRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);
  const serviceRef = useRef<DialogRef>(null);

  const [clashLog, setClashLog] = useClashLog();

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeVerge = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };
  const onUpdateGeo = async () => {
    try {
      await updateGeo();
      Notice.success(t("GeoData Updated"));
    } catch (err: any) {
      Notice.error(err?.response.data.message || err.toString());
    }
  };

  const onFlushFakeip = async () => {
    try {
      await cleanFakeIp();
      Notice.success(t("Fake-IP Cache Flushed"));
    } catch (err: any) {
      Notice.error(err?.response.data.message || err.toString());
    }
  };

  return (
    <SettingList title={t("Clash Setting")}>
      <TunViewer ref={tunRef} />
      <WebUIViewer ref={webRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />
      <ClashCoreViewer
        ref={coreRef}
        serviceActive={serviceStatus === "active"}
      />
      <ServiceViewer ref={serviceRef} enable={!!enable_service_mode} />

      <SettingItem
        disabled={serviceStatus !== "active"}
        label={t("Tun Mode")}
        extra={
          <>
            {serviceStatus !== "active" ? (
              <Tooltip title={t("Tun Mode Info")} placement="top">
                <IconButton color="error" size="small">
                  <InfoRounded fontSize="inherit" />
                </IconButton>
              </Tooltip>
            ) : (
              <IconButton
                color="inherit"
                size="small"
                onClick={() => tunRef.current?.open()}>
                <Settings fontSize="inherit" style={{ opacity: 0.75 }} />
              </IconButton>
            )}
          </>
        }>
        <GuardState
          value={tun?.enable ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          // onChange={(e) => onChangeData({ tun: { enable: e } })}
          onGuard={(e) => patchClash({ tun: { enable: e } })}>
          <SwitchLovely disabled={serviceStatus !== "active"} edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Service Mode")}
        extra={
          <IconButton
            color="inherit"
            size="small"
            onClick={() => serviceRef.current?.open()}>
            <PrivacyTipRounded
              color={
                serviceStatus === "active" || serviceStatus === "installed"
                  ? "inherit"
                  : "error"
              }
              fontSize="inherit"
              style={{ opacity: 0.75 }}
            />
          </IconButton>
        }>
        <GuardState
          value={enable_service_mode ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          // onChange={(e) => onChangeVerge({ enable_service_mode: e })}
          onGuard={(e) => patchVerge({ enable_service_mode: e })}
          onSuccess={() => mutateCheckService()}>
          <SwitchLovely
            edge="end"
            disabled={
              serviceStatus !== "active" && serviceStatus !== "installed"
            }
          />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Unified Delay")}
        extra={
          <Tooltip title={t("Unified Delay Info")} placement="top">
            <IconButton color="inherit" size="small">
              <InfoRounded fontSize="inherit" sx={{ opacity: 0.75 }} />
            </IconButton>
          </Tooltip>
        }>
        <GuardState
          value={UnifiedDelay ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          // onChange={(e) => onChangeData({ "unified-delay": e })}
          onGuard={(e) => patchClash({ "unified-delay": e })}>
          <SwitchLovely edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Allow Lan")}>
        <GuardState
          value={allowLan ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          // onChange={(e) => onChangeData({ "allow-lan": e })}
          onGuard={(e) => patchClash({ "allow-lan": e })}>
          <SwitchLovely edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("IPv6")}>
        <GuardState
          value={ipv6 ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          // onChange={(e) => onChangeData({ ipv6: e })}
          onGuard={(e) => patchClash({ ipv6: e })}>
          <SwitchLovely edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Log Level")}>
        <GuardState
          // clash premium 2022.08.26 值为warn
          value={logLevel === "warn" ? "warning" : (logLevel ?? "info")}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          // onChange={(e) => onChangeData({ "log-level": e })}
          onGuard={(e) => {
            setClashLog((pre: any) => ({ ...pre, logLevel: e }));
            return patchClash({ "log-level": e });
          }}>
          <Select size="small" sx={{ width: 100, "> div": { py: "7.5px" } }}>
            <MenuItem value="debug">Debug</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warning">Warn</MenuItem>
            <MenuItem value="error">Error</MenuItem>
            <MenuItem value="silent">Silent</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Port Config")}
        extra={
          <Tooltip title={t("Random Port")}>
            <IconButton
              color={enable_random_port ? "primary" : "inherit"}
              size="small"
              onClick={() => {
                onChangeVerge({ enable_random_port: !enable_random_port });
                patchVerge({ enable_random_port: !enable_random_port });
                patchClash({ "enable-random-port": !enable_random_port });
              }}>
              <Shuffle
                fontSize="inherit"
                style={{ cursor: "pointer", opacity: 0.75 }}
              />
            </IconButton>
          </Tooltip>
        }>
        <TextField
          disabled={enable_random_port}
          autoComplete="off"
          size="small"
          value={clash?.["mixed-port"] ?? 7890}
          sx={{ width: 100, input: { py: "7.5px", cursor: "pointer" } }}
          onClick={(e) => {
            portRef.current?.open();
            (e.target as any).blur();
          }}
        />
      </SettingItem>

      <SettingItem
        onClick={() => ctrlRef.current?.open()}
        label={t("External")}
      />

      <SettingItem onClick={() => webRef.current?.open()} label={t("Web UI")} />

      <SettingItem
        label={t("Clash Core")}
        extra={
          <IconButton
            color="inherit"
            size="small"
            onClick={() => coreRef.current?.open()}>
            <Settings
              fontSize="inherit"
              style={{ cursor: "pointer", opacity: 0.75 }}
            />
          </IconButton>
        }>
        <Typography sx={{ py: "7px", pr: 1 }}>{version}</Typography>
      </SettingItem>

      {isWIN && (
        <SettingItem onClick={invoke_uwp_tool} label={t("Open UWP tool")} />
      )}

      <SettingItem onClick={onUpdateGeo} label={t("Update GeoData")} />
      <SettingItem onClick={onFlushFakeip} label={t("Flush Fake-IP Cache")} />
    </SettingList>
  );
};

export default SettingClash;
