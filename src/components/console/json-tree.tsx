import { Box, Menu, MenuItem } from "@mui/material";
import React, {
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { useColors } from "./context";
import { ContextMenuState, JsonNodeRef } from "./types";
import { copyToClipboard, getPreview } from "./utils";

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

    if (value === null) {
      return (
        <span style={{ color: colors.null }} onContextMenu={onContextMenu}>
          null
        </span>
      );
    }
    if (value === undefined) {
      return (
        <span style={{ color: colors.null }} onContextMenu={onContextMenu}>
          undefined
        </span>
      );
    }
    if (typeof value === "string") {
      return (
        <span style={{ color: colors.string }} onContextMenu={onContextMenu}>
          "{value}"
        </span>
      );
    }
    if (typeof value === "number") {
      return (
        <span style={{ color: colors.number }} onContextMenu={onContextMenu}>
          {value}
        </span>
      );
    }
    if (typeof value === "boolean") {
      return (
        <span style={{ color: colors.boolean }} onContextMenu={onContextMenu}>
          {String(value)}
        </span>
      );
    }
    return (
      <span style={{ color: colors.string }} onContextMenu={onContextMenu}>
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
export const JsonTree = memo(({ data }: { data: unknown }) => {
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
