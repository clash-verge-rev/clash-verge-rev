import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  Stack,
  Paper,
  Tooltip,
  alpha,
  useTheme,
  Button,
  Fade,
} from "@mui/material";
import { useState, useEffect } from "react";
import ProxyControlSwitches from "@/components/shared/ProxyControlSwitches";
import { Notice } from "@/components/base";
import {
  LanguageRounded,
  ComputerRounded,
  TroubleshootRounded,
  HelpOutlineRounded,
} from "@mui/icons-material";
import useSWR from "swr";
import {
  getSystemProxy,
  getAutotemProxy,
  getRunningMode,
} from "@/services/cmds";

export const ProxyTunCard = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("system");

  // 获取代理状态信息
  const { data: sysproxy } = useSWR("getSystemProxy", getSystemProxy);
  const { data: autoproxy } = useSWR("getAutotemProxy", getAutotemProxy);
  const { data: runningMode } = useSWR("getRunningMode", getRunningMode);

  // 是否以sidecar模式运行
  const isSidecarMode = runningMode === "sidecar";

  // 处理错误
  const handleError = (err: Error) => {
    setError(err.message);
    Notice.error(err.message || err.toString(), 3000);
  };

  // 用户提示文本
  const getTabDescription = (tab: string) => {
    switch (tab) {
      case "system":
        return sysproxy?.enable
          ? t("System Proxy Enabled")
          : t("System Proxy Disabled");
      case "tun":
        return isSidecarMode
          ? t("TUN Mode Service Required")
          : t("TUN Mode Intercept Info");
      default:
        return "";
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {/* 选项卡 */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          display: "flex",
          justifyContent: "center",
          position: "relative",
          zIndex: 2,
        }}
      >
        <Paper
          elevation={activeTab === "system" ? 2 : 0}
          onClick={() => setActiveTab("system")}
          sx={{
            cursor: "pointer",
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            bgcolor:
              activeTab === "system" ? "primary.main" : "background.paper",
            color:
              activeTab === "system" ? "primary.contrastText" : "text.primary",
            borderRadius: 1.5,
            flex: 1,
            maxWidth: 160,
            transition: "all 0.2s ease-in-out",
            position: "relative",
            "&:hover": {
              transform: "translateY(-1px)",
              boxShadow: 1,
            },
            "&:after":
              activeTab === "system"
                ? {
                    content: '""',
                    position: "absolute",
                    bottom: -9,
                    left: "50%",
                    width: 2,
                    height: 9,
                    bgcolor: "primary.main",
                    transform: "translateX(-50%)",
                  }
                : {},
          }}
        >
          <ComputerRounded fontSize="small" />
          <Typography
            variant="body2"
            sx={{ fontWeight: activeTab === "system" ? 600 : 400 }}
          >
            {t("System Proxy")}
          </Typography>
          {sysproxy?.enable && (
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: activeTab === "system" ? "#fff" : "success.main",
                position: "absolute",
                top: 8,
                right: 8,
              }}
            />
          )}
        </Paper>
        <Paper
          elevation={activeTab === "tun" ? 2 : 0}
          onClick={() => setActiveTab("tun")}
          sx={{
            cursor: "pointer",
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            bgcolor: activeTab === "tun" ? "primary.main" : "background.paper",
            color:
              activeTab === "tun" ? "primary.contrastText" : "text.primary",
            borderRadius: 1.5,
            flex: 1,
            maxWidth: 160,
            transition: "all 0.2s ease-in-out",
            position: "relative",
            "&:hover": {
              transform: "translateY(-1px)",
              boxShadow: 1,
            },
            "&:after":
              activeTab === "tun"
                ? {
                    content: '""',
                    position: "absolute",
                    bottom: -9,
                    left: "50%",
                    width: 2,
                    height: 9,
                    bgcolor: "primary.main",
                    transform: "translateX(-50%)",
                  }
                : {},
          }}
        >
          <TroubleshootRounded fontSize="small" />
          <Typography
            variant="body2"
            sx={{ fontWeight: activeTab === "tun" ? 600 : 400 }}
          >
            {t("Tun Mode")}
          </Typography>
        </Paper>
      </Stack>

      {/* 说明文本区域 */}
      <Box
        sx={{
          width: "100%",
          my: 1,
          position: "relative",
          display: "flex",
          justifyContent: "center",
          overflow: "visible",
        }}
      >
        {activeTab === "system" && (
          <Fade in={true} timeout={200}>
            <Typography
              variant="caption"
              component="div"
              sx={{
                width: "95%",
                textAlign: "center",
                color: "text.secondary",
                p: 0.8,
                borderRadius: 1,
                borderColor: "primary.main",
                borderWidth: 1,
                borderStyle: "solid",
                backgroundColor: "background.paper",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.5,
                wordBreak: "break-word",
                hyphens: "auto",
              }}
            >
              {getTabDescription("system")}
              <Tooltip title={t("System Proxy Info")}>
                <HelpOutlineRounded
                  sx={{ fontSize: 14, opacity: 0.7, flexShrink: 0 }}
                />
              </Tooltip>
            </Typography>
          </Fade>
        )}

        {activeTab === "tun" && (
          <Fade in={true} timeout={200}>
            <Typography
              variant="caption"
              component="div"
              sx={{
                width: "95%",
                textAlign: "center",
                color: "text.secondary",
                p: 0.8,
                borderRadius: 1,
                borderColor: "primary.main",
                borderWidth: 1,
                borderStyle: "solid",
                backgroundColor: "background.paper",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.5,
                wordBreak: "break-word",
                hyphens: "auto",
              }}
            >
              {getTabDescription("tun")}
              <Tooltip title={t("Tun Mode Info")}>
                <HelpOutlineRounded
                  sx={{ fontSize: 14, opacity: 0.7, flexShrink: 0 }}
                />
              </Tooltip>
            </Typography>
          </Fade>
        )}
      </Box>

      {/* 控制开关部分 */}
      <Box
        sx={{
          mt: 0,
          p: 1,
          bgcolor: alpha(theme.palette.primary.main, 0.04),
          borderRadius: 2,
        }}
      >
        <ProxyControlSwitches
          onError={handleError}
          label={activeTab === "system" ? t("System Proxy") : t("Tun Mode")}
        />
      </Box>
    </Box>
  );
};
