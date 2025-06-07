import { useTranslation } from "react-i18next";
import {
  Typography,
  Stack,
  Divider,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  InfoOutlined,
  SettingsOutlined,
  WarningOutlined,
  AdminPanelSettingsOutlined,
  DnsOutlined,
  ExtensionOutlined,
} from "@mui/icons-material";
import { useVerge } from "@/hooks/use-verge";
import { EnhancedCard } from "./enhanced-card";
import useSWR from "swr";
import { getSystemInfo } from "@/services/cmds";
import { useNavigate } from "react-router-dom";
import { version as appVersion } from "@root/package.json";
import { useCallback, useEffect, useMemo, useState } from "react";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { useLockFn } from "ahooks";
import { showNotice } from "@/services/noticeService";
import { useSystemState } from "@/hooks/use-system-state";
import { useServiceInstaller } from "@/hooks/useServiceInstaller";

export const SystemInfoCard = () => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();
  const navigate = useNavigate();
  const { isAdminMode, isSidecarMode, mutateRunningMode } = useSystemState();
  const { installServiceAndRestartCore } = useServiceInstaller();

  // 系统信息状态
  const [systemState, setSystemState] = useState({
    osInfo: "",
    lastCheckUpdate: "-",
  });

  // 初始化系统信息
  useEffect(() => {
    getSystemInfo()
      .then((info) => {
        const lines = info.split("\n");
        if (lines.length > 0) {
          const sysName = lines[0].split(": ")[1] || "";
          let sysVersion = lines[1].split(": ")[1] || "";

          if (
            sysName &&
            sysVersion.toLowerCase().startsWith(sysName.toLowerCase())
          ) {
            sysVersion = sysVersion.substring(sysName.length).trim();
          }

          setSystemState((prev) => ({
            ...prev,
            osInfo: `${sysName} ${sysVersion}`,
          }));
        }
      })
      .catch(console.error);

    // 获取最后检查更新时间
    const lastCheck = localStorage.getItem("last_check_update");
    if (lastCheck) {
      try {
        const timestamp = parseInt(lastCheck, 10);
        if (!isNaN(timestamp)) {
          setSystemState((prev) => ({
            ...prev,
            lastCheckUpdate: new Date(timestamp).toLocaleString(),
          }));
        }
      } catch (e) {
        console.error("Error parsing last check update time", e);
      }
    } else if (verge?.auto_check_update) {
      // 如果启用了自动检查更新但没有记录，设置当前时间并延迟检查
      const now = Date.now();
      localStorage.setItem("last_check_update", now.toString());
      setSystemState((prev) => ({
        ...prev,
        lastCheckUpdate: new Date(now).toLocaleString(),
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
      setSystemState((prev) => ({
        ...prev,
        lastCheckUpdate: new Date(now).toLocaleString(),
      }));
      return await checkUpdate();
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 24 * 60 * 60 * 1000, // 每天检查一次
      dedupingInterval: 60 * 60 * 1000, // 1小时内不重复检查
    },
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

  // 点击运行模式处理,Sidecar或纯管理员模式允许安装服务
  const handleRunningModeClick = useCallback(() => {
    if (isSidecarMode || (isAdminMode && isSidecarMode)) {
      installServiceAndRestartCore();
    }
  }, [isSidecarMode, isAdminMode, installServiceAndRestartCore]);

  // 检查更新
  const onCheckUpdate = useLockFn(async () => {
    try {
      const info = await checkUpdate();
      if (!info?.available) {
        showNotice("success", t("Currently on the Latest Version"));
      } else {
        showNotice("info", t("Update Available"), 2000);
        goToSettings();
      }
    } catch (err: any) {
      showNotice("error", err.message || err.toString());
    }
  });

  // 是否启用自启动
  const autoLaunchEnabled = useMemo(
    () => verge?.enable_auto_launch || false,
    [verge],
  );

  // 运行模式样式
  const runningModeStyle = useMemo(
    () => ({
      // Sidecar或纯管理员模式允许安装服务
      cursor:
        isSidecarMode || (isAdminMode && isSidecarMode) ? "pointer" : "default",
      textDecoration:
        isSidecarMode || (isAdminMode && isSidecarMode) ? "underline" : "none",
      display: "flex",
      alignItems: "center",
      gap: 0.5,
      "&:hover": {
        opacity: isSidecarMode || (isAdminMode && isSidecarMode) ? 0.7 : 1,
      },
    }),
    [isSidecarMode, isAdminMode],
  );

  // 获取模式图标和文本
  const getModeIcon = () => {
    if (isAdminMode) {
      // 判断是否为组合模式（管理员+服务）
      if (!isSidecarMode) {
        return (
          <>
            <AdminPanelSettingsOutlined
              sx={{ color: "primary.main", fontSize: 16 }}
              titleAccess={t("Administrator Mode")}
            />
            <DnsOutlined
              sx={{ color: "success.main", fontSize: 16, ml: 0.5 }}
              titleAccess={t("Service Mode")}
            />
          </>
        );
      }
      return (
        <AdminPanelSettingsOutlined
          sx={{ color: "primary.main", fontSize: 16 }}
          titleAccess={t("Administrator Mode")}
        />
      );
    } else if (isSidecarMode) {
      return (
        <ExtensionOutlined
          sx={{ color: "info.main", fontSize: 16 }}
          titleAccess={t("Sidecar Mode")}
        />
      );
    } else {
      return (
        <DnsOutlined
          sx={{ color: "success.main", fontSize: 16 }}
          titleAccess={t("Service Mode")}
        />
      );
    }
  };

  // 获取模式文本
  const getModeText = () => {
    if (isAdminMode) {
      // 判断是否同时处于服务模式
      if (!isSidecarMode) {
        return t("Administrator + Service Mode");
      }
      return t("Administrator Mode");
    } else if (isSidecarMode) {
      return t("Sidecar Mode");
    } else {
      return t("Service Mode");
    }
  };

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
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="body2" color="text.secondary">
            {t("Auto Launch")}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {isAdminMode && (
              <Tooltip
                title={t("Administrator mode may not support auto launch")}
              >
                <WarningOutlined sx={{ color: "warning.main", fontSize: 20 }} />
              </Tooltip>
            )}
            <Chip
              size="small"
              label={autoLaunchEnabled ? t("Enabled") : t("Disabled")}
              color={autoLaunchEnabled ? "success" : "default"}
              variant={autoLaunchEnabled ? "filled" : "outlined"}
              onClick={toggleAutoLaunch}
              sx={{ cursor: "pointer" }}
            />
          </Stack>
        </Stack>
        <Divider />
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="body2" color="text.secondary">
            {t("Running Mode")}
          </Typography>
          <Typography
            variant="body2"
            fontWeight="medium"
            onClick={handleRunningModeClick}
            sx={runningModeStyle}
          >
            {getModeIcon()}
            {getModeText()}
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
