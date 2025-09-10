import { DialogRef, SwitchLovely } from "@/components/base";
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
  Lan,
  PrivacyTipRounded,
  Settings,
  Shuffle,
} from "@mui/icons-material";
import {
  Button,
  ButtonGroup,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { flushDNS, flushFakeIp, updateGeo } from "tauri-plugin-mihomo-api";
import { useNotice } from "../base/notifice";
import { ClashCoreViewer } from "./mods/clash-core-viewer";
import { ClashPortViewer } from "./mods/clash-port-viewer";
import { ControllerViewer } from "./mods/controller-viewer";
import { GuardState } from "./mods/guard-state";
import { NetInfoViewer } from "./mods/net-info-viewer";
import { SettingItem, SettingList } from "./mods/setting-comp";
import { WebUIViewer } from "./mods/web-ui-viewer";
import { useMihomoCoresInfo } from "@/hooks/use-mihomo-cores-info";
import { usePortable } from "@/hooks/use-portable";

const OS = getSystem();

interface Props {
  onError: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation();
  const { notice } = useNotice();
  const { clash, patchClash } = useClash();
  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "unified-delay": unifiedDelay,
    "find-process-mode": findProcessMode,
    tun,
  } = clash ?? {};

  const { verge, mutateVerge, patchVerge } = useVerge();
  const {
    clash_core = "verge-mihomo",
    enable_random_port,
    enable_service_mode,
    enable_external_controller,
  } = verge;
  const { serviceStatus, mutateCheckService } = useService();

  const { mihomoCoresInfo } = useMihomoCoresInfo();
  const mihomoVersion =
    mihomoCoresInfo.find((core) => core.core === clash_core)?.version ??
    "Unknown";

  const permissionsGranted =
    mihomoCoresInfo.find((core) => core.core === clash_core)
      ?.permissionsGranted ?? false;

  const { portable } = usePortable();
  const isLinuxPortable = portable && OS === "linux";
  const disableTunSetting =
    !(isLinuxPortable && permissionsGranted) && serviceStatus !== "active";
  const [_clashLog, setClashLog] = useClashLog();

  const webRef = useRef<DialogRef>(null);
  const portRef = useRef<DialogRef>(null);
  const ctrlRef = useRef<DialogRef>(null);
  const coreRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);
  const serviceRef = useRef<DialogRef>(null);
  const netInfoRef = useRef<DialogRef>(null);

  useEffect(() => {
    if (!verge) return;
    mutateCheckService();
  }, [verge]);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeVerge = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };
  const onUpdateGeo = async () => {
    try {
      await updateGeo();
      notice("success", t("GeoData Updated"));
    } catch (err: any) {
      notice("error", err.message || err.toString());
    }
  };

  const onFlushFakeip = async () => {
    try {
      await flushFakeIp();
      notice(
        "success",
        t("Cache Flushed", {
          cache: "Fake-IP",
        }),
      );
    } catch (err: any) {
      notice("error", err.message || err.toString());
    }
  };

  const onFlushDNS = async () => {
    try {
      await flushDNS();
      notice("success", t("Cache Flushed", { cache: "DNS" }));
    } catch (err: any) {
      notice("error", err.message || err.toString());
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
      <NetInfoViewer ref={netInfoRef} />

      <SettingItem
        disabled={disableTunSetting}
        label={t("Tun Mode")}
        extra={
          <>
            {disableTunSetting ? (
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
          <SwitchLovely disabled={disableTunSetting} edge="end" />
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
          value={unifiedDelay ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          // onChange={(e) => onChangeData({ "unified-delay": e })}
          onGuard={(e) => patchClash({ "unified-delay": e })}>
          <SwitchLovely edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Allow Lan")}
        extra={
          <Tooltip title={t("Network Interface Info")} placement="top">
            <IconButton
              color="inherit"
              size="small"
              onClick={() => {
                netInfoRef.current?.open();
              }}>
              <Lan fontSize="inherit" sx={{ opacity: 0.75 }} />
            </IconButton>
          </Tooltip>
        }>
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

      <SettingItem label={t("Find Process Mode")}>
        <GuardState
          value={findProcessMode}
          valueProps="checked"
          onCatch={onError}
          onGuard={(e) => patchClash({ "find-process-mode": e })}>
          <ButtonGroup size="small" sx={{ my: "4px" }}>
            {(["always", "strict", "off"] as const).map((mode) => {
              const modeName = mode[0].toUpperCase() + mode.slice(1);
              const buttonName = {
                always: "Enable",
                strict: "Auto",
                off: "Disable",
              }[mode];
              return (
                <Tooltip
                  title={t(`Find Process Mode ${modeName}`)}
                  placement="top">
                  <Button
                    key={mode}
                    variant={
                      mode === findProcessMode ? "contained" : "outlined"
                    }
                    onClick={(e) => patchClash({ "find-process-mode": mode })}
                    sx={{ textTransform: "lowercase" }}>
                    {t(buttonName)}
                  </Button>
                </Tooltip>
              );
            })}
          </ButtonGroup>
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
          disabled={enable_random_port ?? false}
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
        label={t("External Controller")}
        extra={
          <IconButton
            color="inherit"
            size="small"
            onClick={() => ctrlRef.current?.open()}>
            <Settings fontSize="inherit" style={{ opacity: 0.75 }} />
          </IconButton>
        }>
        <GuardState
          value={enable_external_controller ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onGuard={(e) => patchVerge({ enable_external_controller: e })}>
          <SwitchLovely edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        openMoreSettings
        onClick={() => webRef.current?.open()}
        label={t("Web UI")}
      />

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
        <Typography sx={{ py: "7px", pr: 1 }}>{mihomoVersion}</Typography>
      </SettingItem>

      {OS === "windows" && (
        <SettingItem onClick={invoke_uwp_tool} label={t("Open UWP tool")} />
      )}

      <SettingItem onClick={onUpdateGeo} label={t("Update GeoData")} />
      <SettingItem
        onClick={onFlushFakeip}
        label={t("Flush Cache", { cache: "Fake-IP" })}
      />
      <SettingItem
        onClick={onFlushDNS}
        label={t("Flush Cache", { cache: "DNS" })}
      />
    </SettingList>
  );
};

export default SettingClash;
