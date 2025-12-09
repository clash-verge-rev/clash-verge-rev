import {
  ComputerRounded,
  TroubleshootRounded,
  HelpOutlineRounded,
  SvgIconComponent,
} from "@mui/icons-material";
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
import { useTranslation } from "react-i18next";

import ProxyControlSwitches from "@/components/shared/proxy-control-switches";
import { useSystemProxyState } from "@/hooks/use-system-proxy-state";
import { useSystemState } from "@/hooks/use-system-state";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/notice-service";

const LOCAL_STORAGE_TAB_KEY = "clash-verge-proxy-active-tab";

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: SvgIconComponent;
  label: string;
  hasIndicator?: boolean;
}

// Tab组件
const TabButton: FC<TabButtonProps> = memo(
  ({ isActive, onClick, icon: Icon, label, hasIndicator = false }) => (
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
      <Typography variant="body2" sx={{ fontWeight: isActive ? 600 : 400 }}>
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
  ),
);

interface TabDescriptionProps {
  description: string;
  tooltipTitle: string;
}

// 描述文本组件
const TabDescription: FC<TabDescriptionProps> = memo(
  ({ description, tooltipTitle }) => (
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
  ),
);

export const ProxyTunCard: FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<string>(
    () => localStorage.getItem(LOCAL_STORAGE_TAB_KEY) || "system",
  );

  const { verge } = useVerge();
  const { isTunModeAvailable } = useSystemState();
  const { actualState: systemProxyActualState } = useSystemProxyState();

  const { enable_tun_mode } = verge ?? {};

  const handleError = (err: unknown) => {
    showNotice.error(err);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    localStorage.setItem(LOCAL_STORAGE_TAB_KEY, tab);
  };

  const tabDescription = useMemo(() => {
    if (activeTab === "system") {
      return {
        text: systemProxyActualState
          ? t("home.components.proxyTun.status.systemProxyEnabled")
          : t("home.components.proxyTun.status.systemProxyDisabled"),
        tooltip: t("home.components.proxyTun.tooltips.systemProxy"),
      };
    } else {
      return {
        text: !isTunModeAvailable
          ? t("home.components.proxyTun.status.tunModeServiceRequired")
          : enable_tun_mode
            ? t("home.components.proxyTun.status.tunModeEnabled")
            : t("home.components.proxyTun.status.tunModeDisabled"),
        tooltip: t("home.components.proxyTun.tooltips.tunMode"),
      };
    }
  }, [
    activeTab,
    systemProxyActualState,
    enable_tun_mode,
    isTunModeAvailable,
    t,
  ]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
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
          label={t("settings.sections.system.toggles.systemProxy")}
          hasIndicator={systemProxyActualState}
        />
        <TabButton
          isActive={activeTab === "tun"}
          onClick={() => handleTabChange("tun")}
          icon={TroubleshootRounded}
          label={t("settings.sections.system.toggles.tunMode")}
          hasIndicator={enable_tun_mode && isTunModeAvailable}
        />
      </Stack>

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
          label={
            activeTab === "system"
              ? t("settings.sections.system.toggles.systemProxy")
              : t("settings.sections.system.toggles.tunMode")
          }
          noRightPadding={true}
        />
      </Box>
    </Box>
  );
};
