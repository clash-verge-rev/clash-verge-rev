import {
  Clear,
  ErrorOutline,
  FilterList,
  InfoOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import React, {
  createContext,
  memo,
  use,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  logInfo: [string, string][];
  onClose: () => void;
}

type LogLevel = "log" | "info" | "warn" | "error" | "exception" | "debug";

// Theme-aware color scheme
interface ColorScheme {
  key: string;
  string: string;
  number: string;
  boolean: string;
  null: string;
  bracket: string;
  arrow: string;
  arrowHover: string;
  collapsed: string;
  background: string;
  toolbar: string;
  border: string;
  text: string;
  textSecondary: string;
  inputBg: string;
  inputHover: string;
  focusRing: string;
  scrollThumb: string;
  scrollThumbHover: string;
  rowHover: string;
  errorBg: string;
  errorBorder: string;
  errorText: string;
  warnBg: string;
  warnBorder: string;
  warnText: string;
  infoText: string;
  logText: string;
  debugText: string;
  errorBadgeBg: string;
  errorBadgeText: string;
  warnBadgeBg: string;
  warnBadgeText: string;
  selectedBg: string;
  // Context menu colors
  menuBg: string;
  menuBorder: string;
  menuText: string;
  menuHoverBg: string;
  menuHoverText: string;
  menuSeparator: string;
}

// Chrome DevTools dark theme
const darkColors: ColorScheme = {
  key: "#5db0d7",
  string: "#f28b54",
  number: "#9980ff",
  boolean: "#9980ff",
  null: "#7f7f7f",
  bracket: "#9aa0a6",
  arrow: "#9aa0a6",
  arrowHover: "#e8eaed",
  collapsed: "#9aa0a6",
  background: "#202124",
  toolbar: "#292a2d",
  border: "#3c4043",
  text: "#e8eaed",
  textSecondary: "#9aa0a6",
  inputBg: "#35363a",
  inputHover: "#3c4043",
  focusRing: "#8ab4f8",
  scrollThumb: "#5f6368",
  scrollThumbHover: "#80868b",
  rowHover: "rgba(255, 255, 255, 0.04)",
  errorBg: "#290000",
  errorBorder: "#ff0000",
  errorText: "#ff8080",
  warnBg: "#332b00",
  warnBorder: "#ffdd9e",
  warnText: "#ffdd9e",
  infoText: "#8ab4f8",
  logText: "#e8eaed",
  debugText: "#9aa0a6",
  errorBadgeBg: "#c33",
  errorBadgeText: "#fff",
  warnBadgeBg: "#c90",
  warnBadgeText: "#000",
  selectedBg: "rgba(255, 255, 255, 0.08)",
  // Context menu - dark theme
  menuBg: "#2d2d2d",
  menuBorder: "#4a4a4a",
  menuText: "#f0f0f0",
  menuHoverBg: "#0066cc",
  menuHoverText: "#ffffff",
  menuSeparator: "#4a4a4a",
};

// Chrome DevTools light theme
const lightColors: ColorScheme = {
  key: "#881280",
  string: "#c41a16",
  number: "#1c00cf",
  boolean: "#0d22aa",
  null: "#5e5e5e",
  bracket: "#303942",
  arrow: "#5f6368",
  arrowHover: "#202124",
  collapsed: "#5f6368",
  background: "#ffffff",
  toolbar: "#f1f3f4",
  border: "#dadce0",
  text: "#202124",
  textSecondary: "#5f6368",
  inputBg: "#ffffff",
  inputHover: "#f1f3f4",
  focusRing: "#1a73e8",
  scrollThumb: "#dadce0",
  scrollThumbHover: "#bdc1c6",
  rowHover: "rgba(0, 0, 0, 0.04)",
  errorBg: "#fff0f0",
  errorBorder: "#ff0000",
  errorText: "#ff0000",
  warnBg: "#fffbe5",
  warnBorder: "#f5c400",
  warnText: "#5c3c00",
  infoText: "#1a73e8",
  logText: "#202124",
  debugText: "#5f6368",
  errorBadgeBg: "#c33",
  errorBadgeText: "#fff",
  warnBadgeBg: "#f5c400",
  warnBadgeText: "#000",
  selectedBg: "rgba(0, 0, 0, 0.08)",
  // Context menu - light theme
  menuBg: "#ffffff",
  menuBorder: "#d0d0d0",
  menuText: "#1a1a1a",
  menuHoverBg: "#0066cc",
  menuHoverText: "#ffffff",
  menuSeparator: "#e5e5e5",
};

// Color context
const ColorContext = createContext<ColorScheme>(darkColors);
const useColors = () => use(ColorContext);

// Try to parse JSON string
const tryParseJson = (str: string): { isJson: boolean; value: unknown } => {
  try {
    const trimmed = str.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return { isJson: true, value: JSON.parse(trimmed) };
    }
    return { isJson: false, value: str };
  } catch {
    return { isJson: false, value: str };
  }
};

// Get preview text for collapsed objects/arrays
const getPreview = (value: unknown, maxLength = 80): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.slice(0, 3).map((v) => {
      if (typeof v === "string") return `"${v}"`;
      if (v === null) return "null";
      if (typeof v === "object") return Array.isArray(v) ? "[…]" : "{…}";
      return String(v);
    });
    const preview = `[${items.join(", ")}${value.length > 3 ? ", …" : ""}]`;
    return preview.length > maxLength
      ? preview.slice(0, maxLength) + "…"
      : preview;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const items = keys.slice(0, 3).map((k) => {
      const v = (value as Record<string, unknown>)[k];
      let valStr: string;
      if (typeof v === "string") valStr = `"${v}"`;
      else if (v === null) valStr = "null";
      else if (typeof v === "object") valStr = Array.isArray(v) ? "[…]" : "{…}";
      else valStr = String(v);
      return `${k}: ${valStr}`;
    });
    const preview = `{${items.join(", ")}${keys.length > 3 ? ", …" : ""}}`;
    return preview.length > maxLength
      ? preview.slice(0, maxLength) + "…"
      : preview;
  }
  return String(value);
};

// Copy to clipboard helper
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};

// Context menu state
interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  type: "primitive" | "object";
  path: string;
  value: unknown;
}

// Render a primitive value with syntax highlighting
const PrimitiveValue = memo(
  ({
    value,
    onContextMenu,
  }: {
    value: unknown;
    onContextMenu?: (e: React.MouseEvent) => void;
  }) => {
    const colors = useColors();
    const style = { cursor: "context-menu" };

    if (value === null) {
      return (
        <span
          style={{ color: colors.null, ...style }}
          onContextMenu={onContextMenu}
        >
          null
        </span>
      );
    }
    if (value === undefined) {
      return (
        <span
          style={{ color: colors.null, ...style }}
          onContextMenu={onContextMenu}
        >
          undefined
        </span>
      );
    }
    if (typeof value === "string") {
      return (
        <span
          style={{ color: colors.string, ...style }}
          onContextMenu={onContextMenu}
        >
          "{value}"
        </span>
      );
    }
    if (typeof value === "number") {
      return (
        <span
          style={{ color: colors.number, ...style }}
          onContextMenu={onContextMenu}
        >
          {value}
        </span>
      );
    }
    if (typeof value === "boolean") {
      return (
        <span
          style={{ color: colors.boolean, ...style }}
          onContextMenu={onContextMenu}
        >
          {String(value)}
        </span>
      );
    }
    return (
      <span
        style={{ color: colors.string, ...style }}
        onContextMenu={onContextMenu}
      >
        {String(value)}
      </span>
    );
  },
);

PrimitiveValue.displayName = "PrimitiveValue";

// Arrow icon for expand/collapse
const Arrow = memo(
  ({ expanded, onClick }: { expanded: boolean; onClick: () => void }) => {
    const colors = useColors();
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          color: colors.arrow,
          cursor: "pointer",
          userSelect: "none",
          display: "inline-block",
          width: 12,
          textAlign: "center",
          transition: "transform 0.1s",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = colors.arrowHover)}
        onMouseLeave={(e) => (e.currentTarget.style.color = colors.arrow)}
      >
        ▶
      </span>
    );
  },
);

Arrow.displayName = "Arrow";

// JsonNode ref interface for controlling expand/collapse
interface JsonNodeRef {
  expandAll: () => void;
  collapseAll: () => void;
}

// JSON Tree Node component
const JsonNode = memo(
  React.forwardRef<
    JsonNodeRef,
    {
      name?: string;
      value: unknown;
      depth?: number;
      defaultExpanded?: boolean;
      path?: string;
      onContextMenu?: (state: ContextMenuState) => void;
    }
  >(
    (
      {
        name,
        value,
        depth = 0,
        defaultExpanded = false,
        path = "",
        onContextMenu,
      },
      ref,
    ) => {
      const colors = useColors();
      const [expanded, setExpanded] = useState(defaultExpanded);
      const childRefs = useRef<Map<string, JsonNodeRef>>(new Map());

      const isObject =
        typeof value === "object" && value !== null && !Array.isArray(value);
      const isArray = Array.isArray(value);
      const isExpandable = isObject || isArray;

      const currentPath =
        name !== undefined ? (path ? `${path}.${name}` : name) : path;

      // Expose expand/collapse methods
      useImperativeHandle(ref, () => ({
        expandAll: () => {
          if (isExpandable) {
            setExpanded(true);
            childRefs.current.forEach((childRef) => childRef.expandAll());
          }
        },
        collapseAll: () => {
          if (isExpandable) {
            setExpanded(false);
            childRefs.current.forEach((childRef) => childRef.collapseAll());
          }
        },
      }));

      const toggle = useCallback(() => setExpanded((e) => !e), []);

      const handleContextMenu = useCallback(
        (e: React.MouseEvent, type: "primitive" | "object") => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu?.({
            mouseX: e.clientX,
            mouseY: e.clientY,
            type,
            path: currentPath,
            value,
          });
        },
        [onContextMenu, currentPath, value],
      );

      const indent = depth * 16;

      // Primitive value
      if (!isExpandable) {
        return (
          <div style={{ paddingLeft: indent, lineHeight: "20px" }}>
            {name !== undefined && (
              <>
                <span
                  style={{ color: colors.key, cursor: "context-menu" }}
                  onContextMenu={(e) => handleContextMenu(e, "primitive")}
                >
                  {name}
                </span>
                <span style={{ color: colors.bracket }}>: </span>
              </>
            )}
            <PrimitiveValue
              value={value}
              onContextMenu={(e) => handleContextMenu(e, "primitive")}
            />
          </div>
        );
      }

      // Object or Array
      const entries = isArray
        ? (value as unknown[]).map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);

      const openBracket = isArray ? "[" : "{";
      const closeBracket = isArray ? "]" : "}";

      return (
        <div style={{ lineHeight: "20px" }}>
          {/* Header line with arrow and brackets */}
          <div
            style={{
              paddingLeft: indent,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
            onClick={toggle}
            onContextMenu={(e) => handleContextMenu(e, "object")}
          >
            <Arrow expanded={expanded} onClick={toggle} />
            <span style={{ marginLeft: 2 }}>
              {name !== undefined && (
                <>
                  <span style={{ color: colors.key }}>{name}</span>
                  <span style={{ color: colors.bracket }}>: </span>
                </>
              )}
              <span style={{ color: colors.bracket }}>{openBracket}</span>
              {!expanded && (
                <span style={{ color: colors.collapsed, marginLeft: 4 }}>
                  {getPreview(value)}
                </span>
              )}
              {!expanded && (
                <span style={{ color: colors.bracket }}>{closeBracket}</span>
              )}
            </span>
          </div>

          {/* Children when expanded */}
          {expanded && (
            <>
              {entries.map(([key, val]) => (
                <JsonNode
                  key={`${depth}-${key}-${typeof val}`}
                  ref={(nodeRef) => {
                    if (nodeRef) {
                      childRefs.current.set(key, nodeRef);
                    } else {
                      childRefs.current.delete(key);
                    }
                  }}
                  name={isArray ? undefined : key}
                  value={val}
                  depth={depth + 1}
                  defaultExpanded={false}
                  path={currentPath}
                  onContextMenu={onContextMenu}
                />
              ))}
              {/* Closing bracket */}
              <div style={{ paddingLeft: indent + 12 }}>
                <span style={{ color: colors.bracket }}>{closeBracket}</span>
              </div>
            </>
          )}
        </div>
      );
    },
  ),
);

JsonNode.displayName = "JsonNode";

// JSON Tree root component with context menu
const JsonTree = memo(({ data }: { data: unknown }) => {
  const colors = useColors();
  const rootRef = useRef<JsonNodeRef>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback((state: ContextMenuState) => {
    setContextMenu(state);
  }, []);

  const handleClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyPath = useCallback(() => {
    if (contextMenu) {
      copyToClipboard(contextMenu.path || "root");
    }
    handleClose();
  }, [contextMenu, handleClose]);

  const handleCopyValue = useCallback(() => {
    if (contextMenu) {
      const val = contextMenu.value;
      if (typeof val === "string") {
        copyToClipboard(val);
      } else {
        copyToClipboard(String(val));
      }
    }
    handleClose();
  }, [contextMenu, handleClose]);

  const handleCopyAsJson = useCallback(() => {
    if (contextMenu) {
      copyToClipboard(JSON.stringify(contextMenu.value, null, 2));
    }
    handleClose();
  }, [contextMenu, handleClose]);

  const handleCopyObject = useCallback(() => {
    if (contextMenu) {
      copyToClipboard(JSON.stringify(contextMenu.value, null, 2));
    }
    handleClose();
  }, [contextMenu, handleClose]);

  const handleExpandAll = useCallback(() => {
    rootRef.current?.expandAll();
    handleClose();
  }, [handleClose]);

  const handleCollapseAll = useCallback(() => {
    rootRef.current?.collapseAll();
    handleClose();
  }, [handleClose]);

  const isPrimitive = contextMenu?.type === "primitive";

  return (
    <Box
      sx={{
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 12,
        lineHeight: "20px",
        "& *": {
          fontFamily: "inherit",
          fontSize: "inherit",
        },
      }}
    >
      <JsonNode
        ref={rootRef}
        value={data}
        defaultExpanded={false}
        onContextMenu={handleContextMenu}
      />

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        slotProps={{
          paper: {
            sx: {
              backgroundColor: colors.menuBg,
              border: `1px solid ${colors.menuBorder}`,
              borderRadius: "12px",
              boxShadow:
                "0 4px 16px rgba(0,0,0,0.2), 0 8px 32px rgba(0,0,0,0.15)",
              minWidth: 140,
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
        {isPrimitive ? (
          <>
            <MenuItem onClick={handleCopyPath}>复制属性路径</MenuItem>
            <MenuItem onClick={handleCopyValue}>复制值</MenuItem>
            <MenuItem onClick={handleCopyAsJson}>复制为 JSON</MenuItem>
          </>
        ) : (
          <>
            <MenuItem onClick={handleCopyObject}>复制 object</MenuItem>
            <MenuItem onClick={handleExpandAll}>以递归方式展开</MenuItem>
            <MenuItem onClick={handleCollapseAll}>收起子级</MenuItem>
          </>
        )}
      </Menu>
    </Box>
  );
});

JsonTree.displayName = "JsonTree";

// Plain text with context menu
const PlainText = memo(
  ({ text, textColor }: { text: string; textColor: string }) => {
    const colors = useColors();
    const [contextMenu, setContextMenu] = useState<{
      mouseX: number;
      mouseY: number;
    } | null>(null);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ mouseX: e.clientX, mouseY: e.clientY });
    }, []);

    const handleClose = useCallback(() => {
      setContextMenu(null);
    }, []);

    const handleCopy = useCallback(() => {
      copyToClipboard(text);
      handleClose();
    }, [text, handleClose]);

    return (
      <>
        <Typography
          component="pre"
          onContextMenu={handleContextMenu}
          sx={{
            fontFamily: "Menlo, Monaco, 'Courier New', monospace",
            fontSize: 12,
            color: textColor,
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: "20px",
            cursor: "context-menu",
          }}
        >
          {text}
        </Typography>
        <Menu
          open={contextMenu !== null}
          onClose={handleClose}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu !== null
              ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
              : undefined
          }
          slotProps={{
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
      </>
    );
  },
);

PlainText.displayName = "PlainText";

// Single log row component
const LogRow = memo(
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

export const LogViewerV2 = (props: Props) => {
  const { open, logInfo, onClose } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const colors = isDark ? darkColors : lightColors;

  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");

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

  // Statistics
  const stats = useMemo(() => {
    const counts = { error: 0, warn: 0, info: 0, log: 0 };
    logInfo.forEach(([level]) => {
      const key = level.toLowerCase();
      if (key === "error" || key === "exception") counts.error++;
      else if (key === "warn") counts.warn++;
      else if (key === "info") counts.info++;
      else counts.log++;
    });
    return counts;
  }, [logInfo]);

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
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: colors.background,
            backgroundImage: "none",
            borderRadius: 1,
            overflow: "hidden",
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

        {/* Toolbar */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.75,
            backgroundColor: colors.toolbar,
            borderBottom: `1px solid ${colors.border}`,
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
              sx={{ "&.Mui-selected": { color: `${colors.text} !important` } }}
            >
              All levels
            </ToggleButton>
            <ToggleButton
              value="error"
              sx={{
                "&.Mui-selected": { color: `${colors.errorText} !important` },
              }}
            >
              Errors
            </ToggleButton>
            <ToggleButton
              value="warn"
              sx={{
                "&.Mui-selected": { color: `${colors.warnText} !important` },
              }}
            >
              Warnings
            </ToggleButton>
            <ToggleButton
              value="info"
              sx={{
                "&.Mui-selected": { color: `${colors.infoText} !important` },
              }}
            >
              Info
            </ToggleButton>
            <ToggleButton
              value="verbose"
              sx={{
                "&.Mui-selected": { color: `${colors.debugText} !important` },
              }}
            >
              Verbose
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Log content */}
        <DialogContent
          sx={{
            p: 0,
            backgroundColor: colors.background,
            height: 400,
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
        </DialogContent>
      </Dialog>
    </ColorContext>
  );
};
