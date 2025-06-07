import { DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { useClash } from "@/hooks/use-clash";
import { useListen } from "@/hooks/use-listen";
import { useVerge } from "@/hooks/use-verge";
import { updateGeoData } from "@/services/api";
import { invoke_uwp_tool } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";
import getSystem from "@/utils/get-system";
import { LanRounded, SettingsRounded } from "@mui/icons-material";
import { MenuItem, Select, TextField, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClashCoreViewer } from "./mods/clash-core-viewer";
import { ClashPortViewer } from "./mods/clash-port-viewer";
import { ControllerViewer } from "./mods/controller-viewer";
import { DnsViewer } from "./mods/dns-viewer";
import { GuardState } from "./mods/guard-state";
import { NetworkInterfaceViewer } from "./mods/network-interface-viewer";
import { SettingItem, SettingList } from "./mods/setting-comp";
import { WebUIViewer } from "./mods/web-ui-viewer";

const isWIN = getSystem() === "windows";

interface Props {
  onError: (err: Error) => void;
}

const SettingClash = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { clash, version, mutateClash, patchClash } = useClash();
  const { verge, mutateVerge, patchVerge } = useVerge();

  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "unified-delay": unifiedDelay,
    dns,
  } = clash ?? {};

  const { enable_random_port = false, verge_mixed_port } = verge ?? {};

  // 独立跟踪DNS设置开关状态
  const [dnsSettingsEnabled, setDnsSettingsEnabled] = useState(() => {
    return verge?.enable_dns_settings ?? false;
  });

  const { addListener } = useListen();

  const webRef = useRef<DialogRef>(null);
  const portRef = useRef<DialogRef>(null);
  const ctrlRef = useRef<DialogRef>(null);
  const coreRef = useRef<DialogRef>(null);
  const networkRef = useRef<DialogRef>(null);
  const dnsRef = useRef<DialogRef>(null);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IConfigData>) => {
    mutateClash((old) => ({ ...(old! || {}), ...patch }), false);
  };
  const onChangeVerge = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };
  const onUpdateGeo = async () => {
    try {
      await updateGeoData();
      showNotice("success", t("GeoData Updated"));
    } catch (err: any) {
      showNotice("error", err?.response.data.message || err.toString());
    }
  };

  // 实现DNS设置开关处理函数
  const handleDnsToggle = useLockFn(async (enable: boolean) => {
    try {
      setDnsSettingsEnabled(enable);
      localStorage.setItem("dns_settings_enabled", String(enable));
      await patchVerge({ enable_dns_settings: enable });
      await invoke("apply_dns_config", { apply: enable });
      setTimeout(() => {
        mutateClash();
      }, 500);
    } catch (err: any) {
      setDnsSettingsEnabled(!enable);
      localStorage.setItem("dns_settings_enabled", String(!enable));
      showNotice("error", err.message || err.toString());
      await patchVerge({ enable_dns_settings: !enable }).catch(() => {});
      throw err;
    }
  });

  return (
    <SettingList title={t("Clash Setting")}>
      <WebUIViewer ref={webRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />
      <ClashCoreViewer ref={coreRef} />
      <NetworkInterfaceViewer ref={networkRef} />
      <DnsViewer ref={dnsRef} />

      <SettingItem
        label={t("Allow Lan")}
        extra={
          <TooltipIcon
            title={t("Network Interface")}
            color={"inherit"}
            icon={LanRounded}
            onClick={() => {
              networkRef.current?.open();
            }}
          />
        }
      >
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

      <SettingItem
        label={t("DNS Overwrite")}
        extra={
          <TooltipIcon
            icon={SettingsRounded}
            onClick={() => dnsRef.current?.open()}
          />
        }
      >
        <Switch
          edge="end"
          checked={dnsSettingsEnabled}
          onChange={(_, checked) => handleDnsToggle(checked)}
        />
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

      <SettingItem
        label={t("Unified Delay")}
        extra={
          <TooltipIcon
            title={t("Unified Delay Info")}
            sx={{ opacity: "0.7" }}
          />
        }
      >
        <GuardState
          value={unifiedDelay ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ "unified-delay": e })}
          onGuard={(e) => patchClash({ "unified-delay": e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Log Level")}
        extra={
          <TooltipIcon title={t("Log Level Info")} sx={{ opacity: "0.7" }} />
        }
      >
        <GuardState
          value={logLevel === "warn" ? "warning" : (logLevel ?? "info")}
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

      <SettingItem label={t("Port Config")}>
        <TextField
          autoComplete="new-password"
          disabled={false}
          size="small"
          value={verge_mixed_port ?? 7897}
          sx={{ width: 100, input: { py: "7.5px", cursor: "pointer" } }}
          onClick={(e) => {
            portRef.current?.open();
            (e.target as any).blur();
          }}
        />
      </SettingItem>

      <SettingItem
        onClick={() => ctrlRef.current?.open()}
        label={
          <>
            {t("External")}
            <TooltipIcon
              title={t(
                "Enable one-click random API port and key. Click to randomize the port and key",
              )}
              sx={{ opacity: "0.7" }}
            />
          </>
        }
      />

      <SettingItem onClick={() => webRef.current?.open()} label={t("Web UI")} />

      <SettingItem
        label={t("Clash Core")}
        extra={
          <TooltipIcon
            icon={SettingsRounded}
            onClick={() => coreRef.current?.open()}
          />
        }
      >
        <Typography sx={{ py: "7px", pr: 1 }}>{version}</Typography>
      </SettingItem>

      {isWIN && (
        <SettingItem
          onClick={invoke_uwp_tool}
          label={t("Open UWP tool")}
          extra={
            <TooltipIcon
              title={t("Open UWP tool Info")}
              sx={{ opacity: "0.7" }}
            />
          }
        />
      )}

      <SettingItem onClick={onUpdateGeo} label={t("Update GeoData")} />
    </SettingList>
  );
};

export default SettingClash;
