import {
  ErrorOutline,
  InfoOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import React, { memo, useMemo } from "react";

import { useColors, useTextMenu } from "./context";
import { JsonTree } from "./json-tree";
import { LogLevel } from "./types";
import { tryParseJson } from "./utils";

// Plain text with context menu (uses global menu from ConsolePanel)
const PlainText = memo(
  ({ text, textColor }: { text: string; textColor: string }) => {
    const { showMenu } = useTextMenu();

    return (
      <Typography
        component="pre"
        onContextMenu={(e) => showMenu(e, text)}
        sx={{
          fontFamily: "Menlo, Monaco, 'Courier New', monospace",
          fontSize: 12,
          color: textColor,
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: "20px",
        }}
      >
        {text}
      </Typography>
    );
  },
);

PlainText.displayName = "PlainText";

// Single log row component
export const LogRow = memo(
  ({ level, message }: { level: string; message: string }) => {
    const colors = useColors();
    const { isJson, value } = tryParseJson(message);

    const levelConfig = useMemo(() => {
      const configs: Record<
        LogLevel,
        {
          icon: React.ReactNode;
          bgColor: string;
          borderColor: string;
          textColor: string;
        }
      > = {
        error: {
          icon: <ErrorOutline sx={{ fontSize: 14 }} />,
          bgColor: colors.errorBg,
          borderColor: colors.errorBorder,
          textColor: colors.errorText,
        },
        exception: {
          icon: <ErrorOutline sx={{ fontSize: 14 }} />,
          bgColor: colors.errorBg,
          borderColor: colors.errorBorder,
          textColor: colors.errorText,
        },
        warn: {
          icon: <WarningAmberOutlined sx={{ fontSize: 14 }} />,
          bgColor: colors.warnBg,
          borderColor: colors.warnBorder,
          textColor: colors.warnText,
        },
        info: {
          icon: <InfoOutlined sx={{ fontSize: 14 }} />,
          bgColor: "transparent",
          borderColor: "transparent",
          textColor: colors.infoText,
        },
        log: {
          icon: null,
          bgColor: "transparent",
          borderColor: "transparent",
          textColor: colors.logText,
        },
        debug: {
          icon: null,
          bgColor: "transparent",
          borderColor: "transparent",
          textColor: colors.debugText,
        },
      };
      return configs[level as LogLevel] || configs.log;
    }, [level, colors]);

    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          px: 1.5,
          py: 0.5,
          backgroundColor: levelConfig.bgColor,
          borderBottom: `1px solid ${colors.border}`,
          borderLeft: `2px solid ${levelConfig.borderColor}`,
          minHeight: 24,
          "&:hover": {
            backgroundColor: colors.rowHover,
          },
        }}
      >
        {/* Icon */}
        {levelConfig.icon && (
          <Box
            sx={{
              color: levelConfig.textColor,
              display: "flex",
              alignItems: "center",
              height: 20,
              flexShrink: 0,
            }}
          >
            {levelConfig.icon}
          </Box>
        )}

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {isJson ? (
            <JsonTree data={value} />
          ) : (
            <PlainText text={message} textColor={levelConfig.textColor} />
          )}
        </Box>
      </Box>
    );
  },
);

LogRow.displayName = "LogRow";
