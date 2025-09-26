import {
  SettingsRounded,
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
  BuildRounded,
  DeleteForeverRounded,
  WarningRounded,
} from "@mui/icons-material";
import { Box, Typography, alpha, useTheme } from "@mui/material";
import { useLockFn } from "ahooks";
import React, { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { GuardState } from "@/components/setting/mods/guard-state";
import { SysproxyViewer } from "@/components/setting/mods/sysproxy-viewer";
import { TunViewer } from "@/components/setting/mods/tun-viewer";
import { useSystemProxyState } from "@/hooks/use-system-proxy-state";
import { useSystemState } from "@/hooks/use-system-state";
import { useVerge } from "@/hooks/use-verge";
import { useServiceInstaller } from "@/hooks/useServiceInstaller";
import { useServiceUninstaller } from "@/hooks/useServiceUninstaller";
import { showNotice } from "@/services/noticeService";

interface ProxySwitchProps {
  label?: string;
  onError?: (err: Error) => void;
  noRightPadding?: boolean;
}

interface SwitchRowProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  infoTitle: string;
  onInfoClick?: () => void;
  extraIcons?: React.ReactNode;
  onToggle: (value: boolean) => Promise<void>;
  onError?: (err: Error) => void;
  highlight?: boolean;
}

/**
 * 抽取的子组件：统一的开关 UI
 */
const SwitchRow = ({
  label,
  active,
  disabled,
  infoTitle,
  onInfoClick,
  extraIcons,
  onToggle,
  onError,
  highlight,
}: SwitchRowProps) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        p: 1,
        pr: 2,
        borderRadius: 1.5,
        bgcolor: highlight
          ? alpha(theme.palette.success.main, 0.07)
          : "transparent",
        opacity: disabled ? 0.6 : 1,
        transition: "background-color 0.3s",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center" }}>
        {active ? (
          <PlayCircleOutlineRounded sx={{ color: "success.main", mr: 1 }} />
        ) : (
          <PauseCircleOutlineRounded sx={{ color: "text.disabled", mr: 1 }} />
        )}
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 500, fontSize: "15px" }}
        >
          {label}
        </Typography>
        <TooltipIcon
          title={infoTitle}
          icon={SettingsRounded}
          onClick={onInfoClick}
          sx={{ ml: 1 }}
        />
        {extraIcons}
      </Box>

      <GuardState
        value={active}
        valueProps="checked"
        onCatch={onError}
        onFormat={(_, v) => v}
        onGuard={onToggle}
      >
        <Switch edge="end" disabled={disabled} />
      </GuardState>
    </Box>
  );
};

const ProxyControlSwitches = ({
  label,
  onError,
  noRightPadding = false,
}: ProxySwitchProps) => {
  const { t } = useTranslation();
  const { verge, mutateVerge, patchVerge } = useVerge();
  const { installServiceAndRestartCore } = useServiceInstaller();
  const { uninstallServiceAndRestartCore } = useServiceUninstaller();
  const { actualState: systemProxyActualState, toggleSystemProxy } =
    useSystemProxyState();
  const {
    isServiceMode,
    isTunModeAvailable,
    mutateRunningMode,
    mutateServiceOk,
  } = useSystemState();

  const sysproxyRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);

  const { enable_tun_mode, enable_system_proxy } = verge ?? {};

  const showErrorNotice = useCallback(
    (msg: string) => showNotice("error", t(msg)),
    [t],
  );

  const handleTunToggle = async (value: boolean) => {
    if (!isTunModeAvailable) {
      const msg = "TUN requires Service Mode or Admin Mode";
      showErrorNotice(msg);
      throw new Error(t(msg));
    }
    mutateVerge({ ...verge, enable_tun_mode: value }, false);
    await patchVerge({ enable_tun_mode: value });
  };

  const onInstallService = useLockFn(async () => {
    try {
      await installServiceAndRestartCore();
      await mutateRunningMode();
      await mutateServiceOk();
    } catch (err) {
      showNotice("error", (err as Error).message || String(err));
    }
  });

  const onUninstallService = useLockFn(async () => {
    try {
      await uninstallServiceAndRestartCore();
      await mutateRunningMode();
      await mutateServiceOk();
    } catch (err) {
      showNotice("error", (err as Error).message || String(err));
    }
  });

  const isSystemProxyMode = label === t("System Proxy") || !label;
  const isTunMode = label === t("Tun Mode");

  return (
    <Box sx={{ width: "100%", pr: noRightPadding ? 1 : 2 }}>
      {isSystemProxyMode && (
        <SwitchRow
          label={t("System Proxy")}
          active={systemProxyActualState}
          infoTitle={t("System Proxy Info")}
          onInfoClick={() => sysproxyRef.current?.open()}
          onToggle={(value) => toggleSystemProxy(value)}
          onError={onError}
          highlight={enable_system_proxy}
        />
      )}

      {isTunMode && (
        <SwitchRow
          label={t("Tun Mode")}
          active={!!enable_tun_mode}
          infoTitle={t("Tun Mode Info")}
          onInfoClick={() => tunRef.current?.open()}
          onToggle={handleTunToggle}
          onError={onError}
          disabled={!isTunModeAvailable}
          highlight={!!enable_tun_mode}
          extraIcons={
            <>
              {!isTunModeAvailable && (
                <TooltipIcon
                  title={t("TUN requires Service Mode or Admin Mode")}
                  icon={WarningRounded}
                  sx={{ color: "warning.main", ml: 1 }}
                />
              )}
              {!isServiceMode ? (
                <TooltipIcon
                  title={t("Install Service")}
                  icon={BuildRounded}
                  color="primary"
                  onClick={onInstallService}
                  sx={{ ml: 1 }}
                />
              ) : (
                <TooltipIcon
                  title={t("Uninstall Service")}
                  icon={DeleteForeverRounded}
                  color="secondary"
                  onClick={onUninstallService}
                  sx={{ ml: 1 }}
                />
              )}
            </>
          }
        />
      )}

      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />
    </Box>
  );
};

export default ProxyControlSwitches;
