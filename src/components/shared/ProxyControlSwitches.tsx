import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsRounded,
  PlayCircleOutlineRounded,
  PauseCircleOutlineRounded,
  BuildRounded,
  DeleteForeverRounded,
  WarningRounded,
} from "@mui/icons-material";
import { Box, Typography, alpha, useTheme } from "@mui/material";
import { DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { GuardState } from "@/components/setting/mods/guard-state";
import { SysproxyViewer } from "@/components/setting/mods/sysproxy-viewer";
import { TunViewer } from "@/components/setting/mods/tun-viewer";
import { useVerge } from "@/hooks/use-verge";
import { useSystemProxyState } from "@/hooks/use-system-proxy-state";
import { useSystemState } from "@/hooks/use-system-state";
import { showNotice } from "@/services/noticeService";
import { useServiceInstaller } from "@/hooks/useServiceInstaller";
import { uninstallService, restartCore, stopCore } from "@/services/cmds";
import { useLockFn } from "ahooks";

interface ProxySwitchProps {
  label?: string;
  onError?: (err: Error) => void;
  noRightPadding?: boolean;
}

/**
 * 可复用的代理控制开关组件
 * 包含 Tun Mode 和 System Proxy 的开关功能
 */
const ProxyControlSwitches = ({
  label,
  onError,
  noRightPadding = false,
}: ProxySwitchProps) => {
  const { t } = useTranslation();
  const { verge, mutateVerge, patchVerge } = useVerge();
  const theme = useTheme();
  const { installServiceAndRestartCore } = useServiceInstaller();

  const { actualState: systemProxyActualState, toggleSystemProxy } =
    useSystemProxyState();

  const { isAdminMode, isServiceMode, mutateRunningMode } = useSystemState();

  const isTunAvailable = isServiceMode || isAdminMode;

  const sysproxyRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);

  const { enable_tun_mode, enable_system_proxy } = verge ?? {};

  // 确定当前显示哪个开关
  const isSystemProxyMode = label === t("System Proxy") || !label;
  const isTunMode = label === t("Tun Mode");

  const onSwitchFormat = (
    _e: React.ChangeEvent<HTMLInputElement>,
    value: boolean,
  ) => value;
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  // 安装系统服务
  const onInstallService = installServiceAndRestartCore;

  // 卸载系统服务
  const onUninstallService = useLockFn(async () => {
    try {
      showNotice("info", t("Stopping Core..."));
      await stopCore();
      showNotice("info", t("Uninstalling Service..."));
      await uninstallService();
      showNotice("success", t("Service Uninstalled Successfully"));
      showNotice("info", t("Restarting Core..."));
      await restartCore();
      await mutateRunningMode();
    } catch (err: unknown) {
      showNotice("error", (err as Error).message || err?.toString());
      try {
        showNotice("info", t("Try running core as Sidecar..."));
        await restartCore();
        await mutateRunningMode();
      } catch (e: unknown) {
        showNotice("error", (e as Error)?.message || e?.toString());
      }
    }
  });

  return (
    <Box sx={{ width: "100%" }}>
      {/* 仅显示当前选中的开关 */}
      {isSystemProxyMode && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 1,
            pr: noRightPadding ? 1 : 2,
            borderRadius: 1.5,
            bgcolor: enable_system_proxy
              ? alpha(theme.palette.success.main, 0.07)
              : "transparent",
            transition: "background-color 0.3s",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {systemProxyActualState ? (
              <PlayCircleOutlineRounded sx={{ color: "success.main", mr: 1 }} />
            ) : (
              <PauseCircleOutlineRounded
                sx={{ color: "text.disabled", mr: 1 }}
              />
            )}

            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 500, fontSize: "15px" }}
            >
              {t("System Proxy")}
            </Typography>
            <TooltipIcon
              title={t("System Proxy Info")}
              icon={SettingsRounded}
              onClick={() => sysproxyRef.current?.open()}
              sx={{ ml: 1 }}
            />
          </Box>

          <GuardState
            value={systemProxyActualState}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onGuard={(e) => toggleSystemProxy(e)}
          >
            <Switch edge="end" />
          </GuardState>
        </Box>
      )}

      {isTunMode && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 1,
            pr: noRightPadding ? 1 : 2,
            borderRadius: 1.5,
            bgcolor: enable_tun_mode
              ? alpha(theme.palette.success.main, 0.07)
              : "transparent",
            opacity: !isTunAvailable ? 0.6 : 1,
            transition: "background-color 0.3s",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {enable_tun_mode ? (
              <PlayCircleOutlineRounded sx={{ color: "success.main", mr: 1 }} />
            ) : (
              <PauseCircleOutlineRounded
                sx={{ color: "text.disabled", mr: 1 }}
              />
            )}

            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 500, fontSize: "15px" }}
            >
              {t("Tun Mode")}
            </Typography>
            <TooltipIcon
              title={t("Tun Mode Info")}
              icon={SettingsRounded}
              onClick={() => tunRef.current?.open()}
              sx={{ ml: 1 }}
            />

            {!isTunAvailable && (
              <TooltipIcon
                title={t("TUN requires Service Mode or Admin Mode")}
                icon={WarningRounded}
                sx={{ color: "warning.main", ml: 1 }}
              />
            )}

            {!isTunAvailable && (
              <TooltipIcon
                title={t("Install Service")}
                icon={BuildRounded}
                color="primary"
                onClick={onInstallService}
                sx={{ ml: 1 }}
              />
            )}

            {isServiceMode && (
              <TooltipIcon
                title={t("Uninstall Service")}
                icon={DeleteForeverRounded}
                color="secondary"
                onClick={onUninstallService}
                sx={{ ml: 1 }}
              />
            )}
          </Box>

          <GuardState
            value={enable_tun_mode ?? false}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => {
              if (!isTunAvailable) {
                showNotice(
                  "error",
                  t("TUN requires Service Mode or Admin Mode"),
                );
                return Promise.reject(
                  new Error(t("TUN requires Service Mode or Admin Mode")),
                );
              }
              onChangeData({ enable_tun_mode: e });
            }}
            onGuard={(e) => {
              if (!isTunAvailable) {
                showNotice(
                  "error",
                  t("TUN requires Service Mode or Admin Mode"),
                );
                return Promise.reject(
                  new Error(t("TUN requires Service Mode or Admin Mode")),
                );
              }
              return patchVerge({ enable_tun_mode: e });
            }}
          >
            <Switch edge="end" disabled={!isTunAvailable} />
          </GuardState>
        </Box>
      )}

      {/* 引用对话框组件 */}
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />
    </Box>
  );
};

export default ProxyControlSwitches;
