import {
  DirectionsRounded,
  LanguageRounded,
  MultipleStopRounded,
} from "@mui/icons-material";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { useLockFn } from "ahooks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { closeAllConnections } from "tauri-plugin-mihomo-api";

import { useClashConfig } from "@/hooks/use-clash-data";
import { useVerge } from "@/hooks/use-verge";
import { patchClashMode } from "@/services/cmds";
import type { TranslationKey } from "@/types/generated/i18n-keys";

const CLASH_MODES = ["rule", "global", "direct"] as const;
type ClashMode = (typeof CLASH_MODES)[number];

const isClashMode = (mode: string): mode is ClashMode =>
  (CLASH_MODES as readonly string[]).includes(mode);

const MODE_META: Record<
  ClashMode,
  { label: TranslationKey; description: TranslationKey }
> = {
  rule: {
    label: "home.components.clashMode.labels.rule",
    description: "home.components.clashMode.descriptions.rule",
  },
  global: {
    label: "home.components.clashMode.labels.global",
    description: "home.components.clashMode.descriptions.global",
  },
  direct: {
    label: "home.components.clashMode.labels.direct",
    description: "home.components.clashMode.descriptions.direct",
  },
};

export const ClashModeCard = () => {
  const { t } = useTranslation();
  const { verge } = useVerge();
  const { clashConfig, refreshClashConfig } = useClashConfig();

  // 支持的模式列表
  const modeList = CLASH_MODES;

  // 直接使用API返回的模式，不维护本地状态
  const currentMode = clashConfig?.mode?.toLowerCase();
  const currentModeKey =
    typeof currentMode === "string" && isClashMode(currentMode)
      ? currentMode
      : undefined;

  const modeDescription = useMemo(() => {
    if (currentModeKey) {
      return t(MODE_META[currentModeKey].description);
    }
    return t("home.components.clashMode.errors.communication");
  }, [currentModeKey, t]);

  // 模式图标映射
  const modeIcons = useMemo(
    () => ({
      rule: <MultipleStopRounded fontSize="small" />,
      global: <LanguageRounded fontSize="small" />,
      direct: <DirectionsRounded fontSize="small" />,
    }),
    [],
  );

  // 切换模式的处理函数
  const onChangeMode = useLockFn(async (mode: ClashMode) => {
    if (mode === currentModeKey) return;
    if (verge?.auto_close_connection) {
      closeAllConnections();
    }

    try {
      await patchClashMode(mode);
      // 使用共享的刷新方法
      refreshClashConfig();
    } catch (error) {
      console.error("Failed to change mode:", error);
    }
  });

  // 按钮样式
  const buttonStyles = (mode: ClashMode) => ({
    cursor: "pointer",
    px: 2,
    py: 1.2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    bgcolor: mode === currentModeKey ? "primary.main" : "background.paper",
    color: mode === currentModeKey ? "primary.contrastText" : "text.primary",
    borderRadius: 1.5,
    transition: "all 0.2s ease-in-out",
    position: "relative",
    overflow: "visible",
    "&:hover": {
      transform: "translateY(-1px)",
      boxShadow: 1,
    },
    "&:active": {
      transform: "translateY(1px)",
    },
    "&::after":
      mode === currentModeKey
        ? {
            content: '""',
            position: "absolute",
            bottom: -16,
            left: "50%",
            width: 2,
            height: 16,
            bgcolor: "primary.main",
            transform: "translateX(-50%)",
          }
        : {},
  });

  // 描述样式
  const descriptionStyles = {
    width: "95%",
    textAlign: "center",
    color: "text.secondary",
    p: 0.8,
    borderRadius: 1,
    borderColor: "primary.main",
    borderWidth: 1,
    borderStyle: "solid",
    backgroundColor: "background.paper",
    wordBreak: "break-word",
    hyphens: "auto",
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {/* 模式选择按钮组 */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          display: "flex",
          justifyContent: "center",
          py: 1,
          position: "relative",
          zIndex: 2,
        }}
      >
        {modeList.map((mode) => (
          <Paper
            key={mode}
            elevation={mode === currentModeKey ? 2 : 0}
            onClick={() => onChangeMode(mode)}
            sx={buttonStyles(mode)}
          >
            {modeIcons[mode]}
            <Typography
              variant="body2"
              sx={{
                textTransform: "capitalize",
                fontWeight: mode === currentModeKey ? 600 : 400,
              }}
            >
              {t(MODE_META[mode].label)}
            </Typography>
          </Paper>
        ))}
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
        <Typography variant="caption" component="div" sx={descriptionStyles}>
          {modeDescription}
        </Typography>
      </Box>
    </Box>
  );
};
