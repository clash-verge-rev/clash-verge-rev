import { useTranslation } from "react-i18next";
import { Typography, Stack, Divider, Chip, IconButton } from "@mui/material";
import { InfoOutlined, SettingsOutlined } from "@mui/icons-material";
import { useVerge } from "@/hooks/use-verge";
import { EnhancedCard } from "./enhanced-card";
import useSWR from "swr";
import { getRunningMode, getSystemInfo, installService } from "@/services/cmds";
import { useNavigate } from "react-router-dom";
import { version as appVersion } from "@root/package.json";
import { useEffect, useState } from "react";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { useLockFn } from "ahooks";
import { Notice } from "@/components/base";

export const SystemInfoCard = () => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();
  const navigate = useNavigate();

  // 获取运行模式
  const { data: runningMode = "sidecar", mutate: mutateRunningMode } = useSWR(
    "getRunningMode",
    getRunningMode,
  );

  // 获取系统信息
  const [osInfo, setOsInfo] = useState<string>("");
  useEffect(() => {
    getSystemInfo()
      .then((info) => {
        const lines = info.split("\n");
        if (lines.length > 0) {
          // 提取系统名称和版本信息
          const sysNameLine = lines[0]; // System Name: xxx
          const sysVersionLine = lines[1]; // System Version: xxx

          const sysName = sysNameLine.split(": ")[1] || "";
          const sysVersion = sysVersionLine.split(": ")[1] || "";

          setOsInfo(`${sysName} ${sysVersion}`);
        }
      })
      .catch((err) => {
        console.error("Error getting system info:", err);
      });
  }, []);

  // 获取最后检查更新时间
  const [lastCheckUpdate, setLastCheckUpdate] = useState<string>("-");

  // 在组件挂载时检查本地存储中的最后更新时间
  useEffect(() => {
    // 获取最后检查更新时间
    const lastCheck = localStorage.getItem("last_check_update");
    if (lastCheck) {
      try {
        const timestamp = parseInt(lastCheck, 10);
        if (!isNaN(timestamp)) {
          const date = new Date(timestamp);
          setLastCheckUpdate(date.toLocaleString());
        }
      } catch (e) {
        console.error("Error parsing last check update time", e);
      }
    } else if (verge?.auto_check_update) {
      // 如果启用了自动检查更新但没有最后检查时间记录，则触发一次检查
      const now = Date.now();
      localStorage.setItem("last_check_update", now.toString());
      setLastCheckUpdate(new Date(now).toLocaleString());

      // 延迟执行检查更新，避免在应用启动时立即执行
      setTimeout(() => {
        checkUpdate().catch((e) => console.error("Error checking update:", e));
      }, 5000);
    }
  }, [verge?.auto_check_update]);

  // 监听 checkUpdate 调用并更新时间
  useSWR(
    "checkUpdate",
    async () => {
      // 更新最后检查时间
      const now = Date.now();
      localStorage.setItem("last_check_update", now.toString());
      setLastCheckUpdate(new Date(now).toLocaleString());

      // 实际执行检查更新
      return await checkUpdate();
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 24 * 60 * 60 * 1000, // 每天检查一次更新
      dedupingInterval: 60 * 60 * 1000, // 1小时内不重复检查,
      isPaused: () => !(verge?.auto_check_update ?? true), // 根据 auto_check_update 设置决定是否启用
    },
  );

  // 导航到设置页面
  const goToSettings = () => {
    navigate("/settings");
  };

  // 切换自启动状态
  const toggleAutoLaunch = async () => {
    try {
      if (!verge) return;
      // 将当前的启动状态取反
      await patchVerge({ enable_auto_launch: !verge.enable_auto_launch });
    } catch (err) {
      console.error("切换开机自启动状态失败:", err);
    }
  };

  // 安装系统服务
  const onInstallService = useLockFn(async () => {
    try {
      Notice.info(t("Installing Service..."), 1000);
      await installService();
      Notice.success(t("Service Installed Successfully"), 2000);
      // 重新获取运行模式
      await mutateRunningMode();
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 3000);
    }
  });

  // 点击运行模式
  const handleRunningModeClick = () => {
    if (runningMode === "sidecar") {
      onInstallService();
    }
  };

  // 检查更新
  const onCheckUpdate = async () => {
    try {
      const info = await checkUpdate();
      if (!info?.available) {
        Notice.success(t("Currently on the Latest Version"));
      } else {
        Notice.info(t("Update Available"), 2000);
        goToSettings(); // 跳转到设置页面查看更新
      }
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  };

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
      {verge && (
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">
              {t("OS Info")}
            </Typography>
            <Typography variant="body2" fontWeight="medium">
              {osInfo}
            </Typography>
          </Stack>
          <Divider />
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">
              {t("Auto Launch")}
            </Typography>
            <Chip
              size="small"
              label={verge.enable_auto_launch ? t("Enabled") : t("Disabled")}
              color={verge.enable_auto_launch ? "success" : "default"}
              variant={verge.enable_auto_launch ? "filled" : "outlined"}
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
              sx={{
                cursor: runningMode === "sidecar" ? "pointer" : "default",
                textDecoration:
                  runningMode === "sidecar" ? "underline" : "none",
                "&:hover": {
                  opacity: runningMode === "sidecar" ? 0.7 : 1,
                },
              }}
            >
              {runningMode === "service"
                ? t("Service Mode")
                : t("Sidecar Mode")}
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
                "&:hover": {
                  opacity: 0.7,
                },
              }}
            >
              {lastCheckUpdate}
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
      )}
    </EnhancedCard>
  );
};
