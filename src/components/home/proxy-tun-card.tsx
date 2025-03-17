import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  Stack,
  Paper,
  Tooltip,
  alpha,
  useTheme,
  Fade,
} from "@mui/material";
import { useState, useMemo, memo, FC } from "react";
import ProxyControlSwitches from "@/components/shared/ProxyControlSwitches";
import { Notice } from "@/components/base";
import {
  ComputerRounded,
  TroubleshootRounded,
  HelpOutlineRounded,
  SvgIconComponent,
} from "@mui/icons-material";
import useSWR from "swr";
import {
  getSystemProxy,
  getAutotemProxy,
  getRunningMode,
} from "@/services/cmds";

const LOCAL_STORAGE_TAB_KEY = "clash-verge-proxy-active-tab";

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: SvgIconComponent;
  label: string;
  hasIndicator?: boolean;
}

// 抽取Tab组件以减少重复代码
const TabButton: FC<TabButtonProps> = memo(({
  isActive,
  onClick,
  icon: Icon,
  label,
  hasIndicator = false
}) => (
  <Paper
    elevation={isActive ? 2 : 0}
    onClick={onClick}
    sx={{
      cursor: "pointer",
      px: 2,
      py: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 1,
      bgcolor: isActive ? "primary.main" : "background.paper",
      color: isActive ? "primary.contrastText" : "text.primary",
      borderRadius: 1.5,
      flex: 1,
      maxWidth: 160,
      transition: "all 0.2s ease-in-out",
      position: "relative",
      "&:hover": {
        transform: "translateY(-1px)",
        boxShadow: 1,
      },
      "&:after": isActive
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
    <Icon fontSize="small" />
    <Typography
      variant="body2"
      sx={{ fontWeight: isActive ? 600 : 400 }}
    >
      {label}
    </Typography>
    {hasIndicator && (
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: isActive ? "#fff" : "success.main",
          position: "absolute",
          top: 8,
          right: 8,
        }}
      />
    )}
  </Paper>
));

interface TabDescriptionProps {
  description: string;
  tooltipTitle: string;
}

// 抽取描述文本组件
const TabDescription: FC<TabDescriptionProps> = memo(({ description, tooltipTitle }) => (
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
      {description}
      <Tooltip title={tooltipTitle}>
        <HelpOutlineRounded
          sx={{ fontSize: 14, opacity: 0.7, flexShrink: 0 }}
        />
      </Tooltip>
    </Typography>
  </Fade>
));

export const ProxyTunCard: FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<string>(() =>
    localStorage.getItem(LOCAL_STORAGE_TAB_KEY) || "system"
  );

  // 获取代理状态信息
  const { data: sysproxy } = useSWR("getSystemProxy", getSystemProxy);
  const { data: runningMode } = useSWR("getRunningMode", getRunningMode);

  // 是否以sidecar模式运行
  const isSidecarMode = runningMode === "sidecar";

  // 处理错误
  const handleError = (err: Error) => {
    Notice.error(err.message || err.toString(), 3000);
  };

  // 处理标签切换并保存到localStorage
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    localStorage.setItem(LOCAL_STORAGE_TAB_KEY, tab);
  };

  // 用户提示文本 - 使用useMemo避免重复计算
  const tabDescription = useMemo(() => {
    if (activeTab === "system") {
      return {
        text: sysproxy?.enable
          ? t("System Proxy Enabled")
          : t("System Proxy Disabled"),
        tooltip: t("System Proxy Info")
      };
    } else {
      return {
        text: isSidecarMode
          ? t("TUN Mode Service Required")
          : t("TUN Mode Intercept Info"),
        tooltip: t("Tun Mode Info")
      };
    }
  }, [activeTab, sysproxy?.enable, isSidecarMode, t]);

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
        <TabButton
          isActive={activeTab === "system"}
          onClick={() => handleTabChange("system")}
          icon={ComputerRounded}
          label={t("System Proxy")}
          hasIndicator={sysproxy?.enable}
        />
        <TabButton
          isActive={activeTab === "tun"}
          onClick={() => handleTabChange("tun")}
          icon={TroubleshootRounded}
          label={t("Tun Mode")}
        />
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
        <TabDescription
          description={tabDescription.text}
          tooltipTitle={tabDescription.tooltip}
        />
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
