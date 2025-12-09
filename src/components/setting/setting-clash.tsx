import { LanRounded, SettingsRounded } from "@mui/icons-material";
import { MenuItem, Select, TextField, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateGeo } from "tauri-plugin-mihomo-api";

import { DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { useClash } from "@/hooks/use-clash";
import { useClashLog } from "@/hooks/use-clash-log";
import { useVerge } from "@/hooks/use-verge";
import { invoke_uwp_tool } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import getSystem from "@/utils/get-system";

import { ClashCoreViewer } from "./mods/clash-core-viewer";
import { ClashPortViewer } from "./mods/clash-port-viewer";
import { ControllerViewer } from "./mods/controller-viewer";
import { DnsViewer } from "./mods/dns-viewer";
import { HeaderConfiguration } from "./mods/external-controller-cors";
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
  const { verge, patchVerge } = useVerge();
  const [, setClashLog] = useClashLog();

  const {
    ipv6,
    "allow-lan": allowLan,
    "log-level": logLevel,
    "unified-delay": unifiedDelay,
  } = clash ?? {};

  const { verge_mixed_port } = verge ?? {};

  // 独立跟踪DNS设置开关状态
  const [dnsSettingsEnabled, setDnsSettingsEnabled] = useState(() => {
    return verge?.enable_dns_settings ?? false;
  });

  const webRef = useRef<DialogRef>(null);
  const portRef = useRef<DialogRef>(null);
  const ctrlRef = useRef<DialogRef>(null);
  const coreRef = useRef<DialogRef>(null);
  const networkRef = useRef<DialogRef>(null);
  const dnsRef = useRef<DialogRef>(null);
  const corsRef = useRef<DialogRef>(null);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IConfigData>) => {
    mutateClash((old) => ({ ...old!, ...patch }), false);
  };
  const onUpdateGeo = async () => {
    try {
      await updateGeo();
      showNotice.success(
        "settings.feedback.notifications.clash.geoDataUpdated",
      );
    } catch (err: any) {
      showNotice.error(err);
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
      showNotice.error(err);
      await patchVerge({ enable_dns_settings: !enable }).catch(() => {});
      throw err;
    }
  });

  return (
    <SettingList title={t("settings.sections.clash.title")}>
      <WebUIViewer ref={webRef} />
      <ClashPortViewer ref={portRef} />
      <ControllerViewer ref={ctrlRef} />
      <ClashCoreViewer ref={coreRef} />
      <NetworkInterfaceViewer ref={networkRef} />
      <DnsViewer ref={dnsRef} />
      <HeaderConfiguration ref={corsRef} />

      <SettingItem
        label={t("settings.sections.clash.form.fields.allowLan")}
        extra={
          <TooltipIcon
            title={t("settings.sections.clash.form.tooltips.networkInterface")}
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
        label={t("settings.sections.clash.form.fields.dnsOverwrite")}
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

      <SettingItem label={t("settings.sections.clash.form.fields.ipv6")}>
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
        label={t("settings.sections.clash.form.fields.unifiedDelay")}
        extra={
          <TooltipIcon
            title={t("settings.sections.clash.form.tooltips.unifiedDelay")}
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
        label={t("settings.sections.clash.form.fields.logLevel")}
        extra={
          <TooltipIcon
            title={t("settings.sections.clash.form.tooltips.logLevel")}
            sx={{ opacity: "0.7" }}
          />
        }
      >
        <GuardState
          value={logLevel === "warn" ? "warning" : (logLevel ?? "info")}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ "log-level": e })}
          onGuard={(e) => {
            setClashLog((pre: any) => ({ ...pre, logLevel: e }));
            return patchClash({ "log-level": e });
          }}
        >
          <Select size="small" sx={{ width: 100, "> div": { py: "7.5px" } }}>
            <MenuItem value="debug">
              {t("settings.sections.clash.form.options.logLevel.debug")}
            </MenuItem>
            <MenuItem value="info">
              {t("settings.sections.clash.form.options.logLevel.info")}
            </MenuItem>
            <MenuItem value="warning">
              {t("settings.sections.clash.form.options.logLevel.warning")}
            </MenuItem>
            <MenuItem value="error">
              {t("settings.sections.clash.form.options.logLevel.error")}
            </MenuItem>
            <MenuItem value="silent">
              {t("settings.sections.clash.form.options.logLevel.silent")}
            </MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("settings.sections.clash.form.fields.portConfig")}>
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
        label={t("settings.sections.clash.form.fields.external")}
        extra={
          <TooltipIcon
            title={t("settings.sections.externalCors.tooltips.open")}
            icon={SettingsRounded}
            onClick={(e) => {
              e.stopPropagation();
              corsRef.current?.open();
            }}
          />
        }
        onClick={() => {
          ctrlRef.current?.open();
        }}
      />

      <SettingItem
        onClick={() => webRef.current?.open()}
        label={t("settings.sections.clash.form.fields.webUI")}
      />

      <SettingItem
        label={t("settings.sections.clash.form.fields.clashCore")}
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
          label={t("settings.sections.clash.form.fields.openUwpTool")}
          extra={
            <TooltipIcon
              title={t("settings.sections.clash.form.tooltips.openUwpTool")}
              sx={{ opacity: "0.7" }}
            />
          }
        />
      )}

      <SettingItem
        onClick={onUpdateGeo}
        label={t("settings.sections.clash.form.fields.updateGeoData")}
      />
    </SettingList>
  );
};

export default SettingClash;
