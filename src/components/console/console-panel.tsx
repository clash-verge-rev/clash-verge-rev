import { FilterList } from "@mui/icons-material";
import {
  Box,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { darkColors, lightColors } from "./colors";
import { ColorContext, TextMenuContext, useColors } from "./context";
import { LogRow } from "./log-row";
import { copyToClipboard } from "./utils";

export interface ConsolePanelProps {
  logInfo: [string, string][];
  /** 是否显示工具栏，默认 true */
  showToolbar?: boolean;
}

// 全局菜单组件
const GlobalTextMenu = ({
  contextMenu,
  onClose,
  onReposition,
}: {
  contextMenu: { mouseX: number; mouseY: number; text: string } | null;
  onClose: () => void;
  onReposition: (e: React.MouseEvent) => void;
}) => {
  const colors = useColors();

  const handleCopy = useCallback(() => {
    if (contextMenu) {
      copyToClipboard(contextMenu.text);
    }
    onClose();
  }, [contextMenu, onClose]);

  // 处理在 backdrop 上右键 - 重新定位菜单
  const handleBackdropContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // 先关闭当前菜单，然后触发重新定位
      onReposition(e);
    },
    [onReposition],
  );

  return (
    <Menu
      open={contextMenu !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu !== null
          ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
          : undefined
      }
      slotProps={{
        backdrop: {
          onContextMenu: handleBackdropContextMenu,
          sx: { backgroundColor: "transparent" },
        },
        paper: {
          sx: {
            backgroundColor: colors.menuBg,
            border: `1px solid ${colors.menuBorder}`,
            borderRadius: "12px",
            boxShadow:
              "0 4px 16px rgba(0,0,0,0.2), 0 8px 32px rgba(0,0,0,0.15)",
            minWidth: 120,
            py: 0.25,
            "& .MuiMenuItem-root": {
              fontSize: 13,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              py: 0.5,
              px: 1,
              minHeight: 26,
              color: colors.menuText,
              "&:hover": {
                backgroundColor: colors.menuHoverBg,
                color: colors.menuHoverText,
              },
            },
          },
        },
      }}
    >
      <MenuItem onClick={handleCopy}>复制</MenuItem>
    </Menu>
  );
};

/** 控制台面板 - 纯内容组件，不包含弹窗 */
export const ConsolePanel = (props: ConsolePanelProps) => {
  const { logInfo, showToolbar = true } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const colors = isDark ? darkColors : lightColors;

  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  // 全局文本右键菜单状态
  const [textMenu, setTextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    text: string;
  } | null>(null);

  const showMenu = useCallback((e: React.MouseEvent, text: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTextMenu({ mouseX: e.clientX, mouseY: e.clientY, text });
  }, []);

  const closeMenu = useCallback(() => {
    setTextMenu(null);
  }, []);

  // 处理在菜单 backdrop 上右键 - 尝试找到鼠标下方的文本元素
  const handleReposition = useCallback((e: React.MouseEvent) => {
    // 获取鼠标位置下的元素
    const element = document.elementFromPoint(e.clientX, e.clientY);
    if (element) {
      // 查找最近的 pre 元素（日志文本）
      const preElement = element.closest("pre");
      if (preElement && preElement.textContent) {
        setTextMenu({
          mouseX: e.clientX,
          mouseY: e.clientY,
          text: preElement.textContent,
        });
        return;
      }
    }
    // 如果没找到文本元素，关闭菜单
    setTextMenu(null);
  }, []);

  const textMenuValue = useMemo(() => ({ showMenu }), [showMenu]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    const levelFilterMap: Record<string, string[]> = {
      all: ["log", "info", "warn", "error", "exception", "debug"],
      error: ["error", "exception"],
      warn: ["warn"],
      info: ["info"],
      verbose: ["log", "debug"],
    };
    const allowedLevels = levelFilterMap[levelFilter] || levelFilterMap.all;
    return logInfo.filter(([level, message]) => {
      const normalizedLevel = level.toLowerCase();
      if (!allowedLevels.includes(normalizedLevel)) return false;
      if (filter && !message.toLowerCase().includes(filter.toLowerCase()))
        return false;
      return true;
    });
  }, [logInfo, filter, levelFilter]);

  const handleLevelChange = (
    _: React.MouseEvent<HTMLElement>,
    newLevel: string | null,
  ) => {
    if (newLevel !== null) {
      setLevelFilter(newLevel);
    }
  };

  return (
    <ColorContext value={colors}>
      <TextMenuContext value={textMenuValue}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: colors.background,
            height: "100%",
          }}
        >
          {/* Toolbar - height: 40px */}
          {showToolbar && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                height: 40,
                backgroundColor: colors.toolbar,
                borderBottom: `1px solid ${colors.border}`,
                flexShrink: 0,
              }}
            >
              <TextField
                size="small"
                placeholder={t("profiles.modals.logViewerV2.filter")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <FilterList
                          sx={{ color: colors.textSecondary, fontSize: 16 }}
                        />
                      </InputAdornment>
                    ),
                    sx: {
                      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
                      fontSize: 12,
                      color: colors.text,
                      backgroundColor: colors.inputBg,
                      borderRadius: 0.5,
                      height: 28,
                      border: `1px solid ${colors.border}`,
                      "& input": { py: 0.5 },
                      "& fieldset": { border: "none" },
                      "&:hover": { backgroundColor: colors.inputHover },
                      "&.Mui-focused": {
                        backgroundColor: colors.inputBg,
                        boxShadow: `0 0 0 1px ${colors.focusRing}`,
                      },
                    },
                  },
                }}
                sx={{ flex: 1, maxWidth: 240 }}
              />

              <ToggleButtonGroup
                value={levelFilter}
                onChange={handleLevelChange}
                exclusive
                size="small"
                sx={{
                  gap: 0.25,
                  "& .MuiToggleButtonGroup-grouped": {
                    border: "none !important",
                    borderRadius: "4px !important",
                  },
                  "& .MuiToggleButton-root": {
                    px: 1,
                    py: 0.25,
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: "none",
                    color: colors.textSecondary,
                    "&.Mui-selected": {
                      backgroundColor: colors.selectedBg,
                    },
                    "&:hover": { backgroundColor: colors.selectedBg },
                  },
                }}
              >
                <ToggleButton
                  value="all"
                  sx={{
                    "&.Mui-selected": { color: `${colors.text} !important` },
                  }}
                >
                  All levels
                </ToggleButton>
                <ToggleButton
                  value="error"
                  sx={{
                    "&.Mui-selected": {
                      color: `${colors.errorText} !important`,
                    },
                  }}
                >
                  Errors
                </ToggleButton>
                <ToggleButton
                  value="warn"
                  sx={{
                    "&.Mui-selected": {
                      color: `${colors.warnText} !important`,
                    },
                  }}
                >
                  Warnings
                </ToggleButton>
                <ToggleButton
                  value="info"
                  sx={{
                    "&.Mui-selected": {
                      color: `${colors.infoText} !important`,
                    },
                  }}
                >
                  Info
                </ToggleButton>
                <ToggleButton
                  value="verbose"
                  sx={{
                    "&.Mui-selected": {
                      color: `${colors.debugText} !important`,
                    },
                  }}
                >
                  Verbose
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {/* Log content */}
          <Box
            onContextMenu={(e) => e.preventDefault()}
            sx={{
              height: showToolbar ? "calc(100% - 40px)" : "100%",
              overflow: "auto",
              "&::-webkit-scrollbar": { width: 10, height: 10 },
              "&::-webkit-scrollbar-track": {
                backgroundColor: colors.background,
              },
              "&::-webkit-scrollbar-thumb": {
                backgroundColor: colors.scrollThumb,
                borderRadius: 5,
                "&:hover": { backgroundColor: colors.scrollThumbHover },
              },
            }}
          >
            {filteredLogs.length > 0 ? (
              filteredLogs.map(([level, message]) => (
                <LogRow
                  key={`${level}-${message.slice(0, 50)}-${message.length}`}
                  level={level}
                  message={message}
                />
              ))
            ) : (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: colors.textSecondary,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 12,
                    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
                  }}
                >
                  {logInfo.length === 0
                    ? t("profiles.modals.logViewerV2.noLogs")
                    : t("profiles.modals.logViewerV2.noMatch")}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Global text menu */}
          <GlobalTextMenu
            contextMenu={textMenu}
            onClose={closeMenu}
            onReposition={handleReposition}
          />
        </Box>
      </TextMenuContext>
    </ColorContext>
  );
};
