import { useTranslation } from "react-i18next";
import { Box, Typography, Paper, Stack, Fade } from "@mui/material";
import { useLockFn } from "ahooks";
import { closeAllConnections } from "@/services/api";
import { patchClashMode } from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import {
  LanguageRounded,
  MultipleStopRounded,
  DirectionsRounded,
} from "@mui/icons-material";
import { useMemo } from "react";
import { useAppData } from "@/providers/app-data-provider";

export const ClashModeCard = () => {
  const { t } = useTranslation();
  const { verge } = useVerge();
  const { clashConfig, refreshClashConfig } = useAppData();

  // 支持的模式列表
  const modeList = useMemo(() => ["rule", "global", "direct"] as const, []);

  // 直接使用API返回的模式，不维护本地状态
  const currentMode = clashConfig?.mode?.toLowerCase();

  // 模式图标映射
  const modeIcons = useMemo(() => ({
    rule: <MultipleStopRounded fontSize="small" />,
    global: <LanguageRounded fontSize="small" />,
    direct: <DirectionsRounded fontSize="small" />
  }), []);

  // 切换模式的处理函数
  const onChangeMode = useLockFn(async (mode: string) => {
    if (mode === currentMode) return;
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
  const buttonStyles = (mode: string) => ({
    cursor: "pointer",
    px: 2,
    py: 1.2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    bgcolor: mode === currentMode ? "primary.main" : "background.paper",
    color: mode === currentMode ? "primary.contrastText" : "text.primary",
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
    "&::after": mode === currentMode
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
            elevation={mode === currentMode ? 2 : 0}
            onClick={() => onChangeMode(mode)}
            sx={buttonStyles(mode)}
          >
            {modeIcons[mode]}
            <Typography
              variant="body2"
              sx={{
                textTransform: "capitalize",
                fontWeight: mode === currentMode ? 600 : 400,
              }}
            >
              {t(mode)}
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
        <Typography
          variant="caption"
          component="div"
          sx={descriptionStyles}
        >
          {t(`${currentMode} Mode Description`)}
        </Typography>
      </Box>
    </Box>
  );
};
