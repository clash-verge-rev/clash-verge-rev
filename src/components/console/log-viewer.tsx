import { Clear } from "@mui/icons-material";
import {
  Box,
  Dialog,
  DialogTitle,
  IconButton,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { darkColors, lightColors } from "./colors";
import { ConsolePanel } from "./console-panel";
import { getConsoleStats } from "./utils";

interface Props {
  open: boolean;
  logInfo: [string, string][];
  onClose: () => void;
}

/** 日志查看器弹窗 */
export const LogViewer = (props: Props) => {
  const { open, logInfo, onClose } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const colors = isDark ? darkColors : lightColors;

  const stats = useMemo(() => getConsoleStats(logInfo), [logInfo]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        backdrop: {
          onContextMenu: (e) => e.preventDefault(),
        },
      }}
      PaperProps={{
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        sx: {
          backgroundColor: colors.background,
          backgroundImage: "none",
          borderRadius: 1,
          overflow: "hidden",
          height: "70vh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: colors.toolbar,
          borderBottom: `1px solid ${colors.border}`,
          py: 1,
          px: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography
            sx={{ color: colors.text, fontSize: 13, fontWeight: 500 }}
          >
            {t("profiles.modals.logViewerV2.title")}
          </Typography>

          {/* Stats badges */}
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {stats.error > 0 && (
              <Box
                sx={{
                  backgroundColor: colors.errorBadgeBg,
                  color: colors.errorBadgeText,
                  px: 0.75,
                  py: 0.125,
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {stats.error}
              </Box>
            )}
            {stats.warn > 0 && (
              <Box
                sx={{
                  backgroundColor: colors.warnBadgeBg,
                  color: colors.warnBadgeText,
                  px: 0.75,
                  py: 0.125,
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {stats.warn}
              </Box>
            )}
          </Box>
        </Box>

        <IconButton
          size="small"
          onClick={onClose}
          sx={{
            color: colors.textSecondary,
            "&:hover": {
              color: colors.text,
              backgroundColor: colors.selectedBg,
            },
          }}
        >
          <Clear sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      {/* Console Content */}
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <ConsolePanel logInfo={logInfo} />
      </Box>
    </Dialog>
  );
};
