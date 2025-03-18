import { useTranslation } from "react-i18next";
import { Typography, Stack, Divider, Chip, IconButton } from "@mui/material";
import { InfoOutlined, SettingsOutlined } from "@mui/icons-material";
import { useVerge } from "@/hooks/use-verge";
import { EnhancedCard } from "./enhanced-card";
import useSWR from "swr";
import { getRunningMode, getSystemInfo, installService } from "@/services/cmds";
import { useNavigate } from "react-router-dom";
import { version as appVersion } from "@root/package.json";
import { useCallback, useEffect, useMemo, useState } from "react";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { useLockFn } from "ahooks";
import { Notice } from "@/components/base";

export const SystemInfoCard = () => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();
  const navigate = useNavigate();

  // 系统信息状态
  const [systemState, setSystemState] = useState({
    osInfo: "",
    lastCheckUpdate: "-",
  });

  // 获取运行模式
  const { data: runningMode = "sidecar", mutate: mutateRunningMode } = useSWR(
    "getRunningMode",
    getRunningMode,
    { suspense: false, revalidateOnFocus: false }
  );

  // 是否以sidecar模式运行
  const isSidecarMode = runningMode === "sidecar";

  // 初始化系统信息
  useEffect(() => {
    // 获取系统信息
    getSystemInfo()
      .then((info) => {
        const lines = info.split("\n");
        if (lines.length > 0) {
          const sysName = lines[0].split(": ")[1] || "";
          const sysVersion = lines[1].split(": ")[1] || "";
          setSystemState(prev => ({ ...prev, osInfo: `${sysName} ${sysVersion}` }));
        }
      })
      .catch(console.error);

    // 获取最后检查更新时间
    const lastCheck = localStorage.getItem("last_check_update");
    if (lastCheck) {
      try {
        const timestamp = parseInt(lastCheck, 10);
        if (!isNaN(timestamp)) {
          setSystemState(prev => ({ 
            ...prev, 
            lastCheckUpdate: new Date(timestamp).toLocaleString() 
          }));
        }
      } catch (e) {
        console.error("Error parsing last check update time", e);
      }
    } else if (verge?.auto_check_update) {
      // 如果启用了自动检查更新但没有记录，设置当前时间并延迟检查
      const now = Date.now();
      localStorage.setItem("last_check_update", now.toString());
      setSystemState(prev => ({ 
        ...prev, 
        lastCheckUpdate: new Date(now).toLocaleString() 
      }));
      
      setTimeout(() => {
        if (verge?.auto_check_update) {
          checkUpdate().catch(console.error);
        }
      }, 5000);
    }
  }, [verge?.auto_check_update]);

  // 自动检查更新逻辑
  useSWR(
    verge?.auto_check_update ? "checkUpdate" : null,
    async () => {
      const now = Date.now();
      localStorage.setItem("last_check_update", now.toString());
      setSystemState(prev => ({ 
        ...prev, 
        lastCheckUpdate: new Date(now).toLocaleString() 
      }));
      return await checkUpdate();
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 24 * 60 * 60 * 1000, // 每天检查一次
      dedupingInterval: 60 * 60 * 1000, // 1小时内不重复检查
    }
  );

  // 导航到设置页面
  const goToSettings = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  // 切换自启动状态
  const toggleAutoLaunch = useCallback(async () => {
    if (!verge) return;
    try {
      await patchVerge({ enable_auto_launch: !verge.enable_auto_launch });
    } catch (err) {
      console.error("切换开机自启动状态失败:", err);
    }
  }, [verge, patchVerge]);

  // 安装系统服务
  const onInstallService = useLockFn(async () => {
    try {
      Notice.info(t("Installing Service..."), 1000);
      await installService();
      Notice.success(t("Service Installed Successfully"), 2000);
      await mutateRunningMode();
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 3000);
    }
  });

  // 点击运行模式处理
  const handleRunningModeClick = useCallback(() => {
    if (isSidecarMode) {
      onInstallService();
    }
  }, [isSidecarMode, onInstallService]);

  // 检查更新
  const onCheckUpdate = useLockFn(async () => {
    try {
      const info = await checkUpdate();
      if (!info?.available) {
        Notice.success(t("Currently on the Latest Version"));
      } else {
        Notice.info(t("Update Available"), 2000);
        goToSettings();
      }
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  // 是否启用自启动
  const autoLaunchEnabled = useMemo(() => verge?.enable_auto_launch || false, [verge]);

  // 运行模式样式
  const runningModeStyle = useMemo(() => ({
    cursor: isSidecarMode ? "pointer" : "default",
    textDecoration: isSidecarMode ? "underline" : "none",
    "&:hover": {
      opacity: isSidecarMode ? 0.7 : 1,
    },
  }), [isSidecarMode]);

  // 只有当verge存在时才渲染内容
  if (!verge) return null;

  return (
    <EnhancedCard
      title={t("System Info")}
      icon={<InfoOutlined />}
      iconColor="error"
      action={
        <IconButton size="small" onClick={goToSettings} title={t("Settings")}>
          <SettingsOutlined fontSize="small" />
        </IconButton>
      }
    >
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("OS Info")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {systemState.osInfo}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Auto Launch")}
          </Typography>
          <Chip
            size="small"
            label={autoLaunchEnabled ? t("Enabled") : t("Disabled")}
            color={autoLaunchEnabled ? "success" : "default"}
            variant={autoLaunchEnabled ? "filled" : "outlined"}
            onClick={toggleAutoLaunch}
            sx={{ cursor: "pointer" }}
          />
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Running Mode")}
          </Typography>
          <Typography
            variant="body2"
            fontWeight="medium"
            onClick={handleRunningModeClick}
            sx={runningModeStyle}
          >
            {isSidecarMode ? t("Sidecar Mode") : t("Service Mode")}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Last Check Update")}
          </Typography>
          <Typography
            variant="body2"
            fontWeight="medium"
            onClick={onCheckUpdate}
            sx={{
              cursor: "pointer",
              textDecoration: "underline",
              "&:hover": { opacity: 0.7 },
            }}
          >
            {systemState.lastCheckUpdate}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Verge Version")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            v{appVersion}
          </Typography>
        </Stack>
      </Stack>
    </EnhancedCard>
  );
};
