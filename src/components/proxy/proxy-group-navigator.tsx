import { Box, Button, Tooltip } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";

interface ProxyGroupNavigatorProps {
  proxyGroupNames: string[];
  onGroupLocation: (groupName: string) => void;
  enableHoverJump?: boolean;
  hoverDelay?: number;
}

export const DEFAULT_HOVER_DELAY = 280;

// 提取代理组名的第一个字符
const getGroupDisplayChar = (groupName: string): string => {
  if (!groupName) return "?";

  // 直接返回第一个字符，支持表情符号
  const firstChar = Array.from(groupName)[0];
  return firstChar || "?";
};

export const ProxyGroupNavigator = ({
  proxyGroupNames,
  onGroupLocation,
  enableHoverJump = true,
  hoverDelay = DEFAULT_HOVER_DELAY,
}: ProxyGroupNavigatorProps) => {
  const lastHoveredRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoverDelayMs = hoverDelay >= 0 ? hoverDelay : 0;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enableHoverJump) {
      clearHoverTimer();
      lastHoveredRef.current = null;
    }
    return () => {
      clearHoverTimer();
    };
  }, [clearHoverTimer, enableHoverJump]);

  const handleGroupClick = useCallback(
    (groupName: string) => {
      clearHoverTimer();
      lastHoveredRef.current = groupName;
      onGroupLocation(groupName);
    },
    [clearHoverTimer, onGroupLocation],
  );

  const handleGroupHover = useCallback(
    (groupName: string) => {
      if (!enableHoverJump) return;
      if (lastHoveredRef.current === groupName) return;
      clearHoverTimer();
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        lastHoveredRef.current = groupName;
        onGroupLocation(groupName);
      }, hoverDelayMs);
    },
    [clearHoverTimer, enableHoverJump, hoverDelayMs, onGroupLocation],
  );

  const handleButtonLeave = useCallback(() => {
    clearHoverTimer();
    lastHoveredRef.current = null;
  }, [clearHoverTimer]);

  // 处理代理组数据，去重和排序
  const processedGroups = useMemo(() => {
    return proxyGroupNames
      .filter((name) => name && name.trim())
      .map((name) => ({
        name,
        displayChar: getGroupDisplayChar(name),
      }));
  }, [proxyGroupNames]);

  if (processedGroups.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: "absolute",
        right: 2,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
        bgcolor: "transparent",
        borderRadius: 0.5,
        boxShadow: 0,
        p: 0.25,
        maxHeight: "70vh",
        overflowY: "auto",
        minWidth: "auto",
      }}
    >
      {processedGroups.map(({ name, displayChar }) => (
        <Tooltip key={name} title={name} placement="left" arrow>
          <Button
            size="small"
            variant="text"
            onClick={() => handleGroupClick(name)}
            onMouseEnter={() => handleGroupHover(name)}
            onFocus={() => handleGroupHover(name)}
            onMouseLeave={handleButtonLeave}
            onBlur={handleButtonLeave}
            sx={{
              minWidth: 28,
              minHeight: 28,
              width: 28,
              height: 28,
              fontSize: "12px",
              fontWeight: 600,
              padding: 0,
              borderRadius: 0.25,
              color: "text.secondary",
              textAlign: "center",
              justifyContent: "center",
              textTransform: "none",
              "&:hover": {
                bgcolor: "primary.light",
                color: "primary.contrastText",
              },
            }}
          >
            {displayChar}
          </Button>
        </Tooltip>
      ))}
    </Box>
  );
};
