import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Typography,
  Paper,
  alpha,
  useTheme,
  PaletteColor,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import {
  ArrowUpwardRounded,
  ArrowDownwardRounded,
  MemoryRounded,
  LinkRounded,
  CloudUploadRounded,
  CloudDownloadRounded,
} from "@mui/icons-material";
import {
  EnhancedTrafficGraph,
  EnhancedTrafficGraphRef,
  ITrafficItem,
} from "./enhanced-traffic-graph";
import { useVisibility } from "@/hooks/use-visibility";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { createAuthSockette } from "@/utils/websocket";
import parseTraffic from "@/utils/parse-traffic";
import { getConnections, isDebugEnabled, gc } from "@/services/api";
import { ReactNode } from "react";

interface MemoryUsage {
  inuse: number;
  oslimit?: number;
}

interface TrafficStatData {
  uploadTotal: number;
  downloadTotal: number;
  activeConnections: number;
}

interface StatCardProps {
  icon: ReactNode;
  title: string;
  value: string | number;
  unit: string;
  color: "primary" | "secondary" | "error" | "warning" | "info" | "success";
  onClick?: () => void;
}

// 全局变量类型定义
declare global {
  interface Window {
    animationFrameId?: number;
    lastTrafficData?: {
      up: number;
      down: number;
    };
  }
}

// 控制更新频率
const CONNECTIONS_UPDATE_INTERVAL = 5000; // 5秒更新一次连接数据
const THROTTLE_TRAFFIC_UPDATE = 500; // 500ms节流流量数据更新

// 统计卡片组件 - 使用memo优化
const CompactStatCard = memo(({
  icon,
  title,
  value,
  unit,
  color,
  onClick,
}: StatCardProps) => {
  const theme = useTheme();
  
  // 获取调色板颜色 - 使用useMemo避免重复计算
  const colorValue = useMemo(() => {
    const palette = theme.palette;
    if (
      color in palette &&
      palette[color as keyof typeof palette] &&
      "main" in (palette[color as keyof typeof palette] as PaletteColor)
    ) {
      return (palette[color as keyof typeof palette] as PaletteColor).main;
    }
    return palette.primary.main;
  }, [theme.palette, color]);
  
  return (
    <Paper
      elevation={0}
      sx={{
        display: "flex",
        alignItems: "center",
        borderRadius: 2,
        bgcolor: alpha(colorValue, 0.05),
        border: `1px solid ${alpha(colorValue, 0.15)}`,
        padding: "8px",
        transition: "all 0.2s ease-in-out",
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? {
          bgcolor: alpha(colorValue, 0.1),
          border: `1px solid ${alpha(colorValue, 0.3)}`,
          boxShadow: `0 4px 8px rgba(0,0,0,0.05)`,
        } : {},
      }}
      onClick={onClick}
    >
      {/* 图标容器 */}
      <Grid
        component="div"
        sx={{
          mr: 1,
          ml: "2px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: "50%",
          bgcolor: alpha(colorValue, 0.1),
          color: colorValue,
        }}
      >
        {icon}
      </Grid>

      {/* 文本内容 */}
      <Grid component="div" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {title}
        </Typography>
        <Grid component="div" sx={{ display: "flex", alignItems: "baseline" }}>
          <Typography variant="body1" fontWeight="bold" noWrap sx={{ mr: 0.5 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {unit}
          </Typography>
        </Grid>
      </Grid>
    </Paper>
  );
});

// 添加显示名称
CompactStatCard.displayName = "CompactStatCard";

export const EnhancedTrafficStats = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { clashInfo } = useClashInfo();
  const { verge } = useVerge();
  const trafficRef = useRef<EnhancedTrafficGraphRef>(null);
  const pageVisible = useVisibility();
  const [isDebug, setIsDebug] = useState(false);
  
  // 使用单一状态对象减少状态更新次数
  const [stats, setStats] = useState({
    traffic: { up: 0, down: 0 },
    memory: { inuse: 0, oslimit: undefined as number | undefined },
    connections: { uploadTotal: 0, downloadTotal: 0, activeConnections: 0 },
  });

  // 创建一个标记来追踪最后更新时间，用于节流
  const lastUpdateRef = useRef({ traffic: 0 });
  
  // 是否显示流量图表
  const trafficGraph = verge?.traffic_graph ?? true;

  // WebSocket引用
  const socketRefs = useRef({
    traffic: null as ReturnType<typeof createAuthSockette> | null,
    memory: null as ReturnType<typeof createAuthSockette> | null,
  });

  // 获取连接数据
  const fetchConnections = useCallback(async () => {
    if (!pageVisible) return;
    
    try {
      const connections = await getConnections();
      if (connections) {
        setStats(prev => ({
          ...prev,
          connections: {
            uploadTotal: connections.uploadTotal || 0,
            downloadTotal: connections.downloadTotal || 0,
            activeConnections: connections.connections ? connections.connections.length : 0,
          }
        }));
      }
    } catch (err) {
      console.error("Failed to fetch connections:", err);
    }
  }, [pageVisible]);

  // 定期更新连接数据
  useEffect(() => {
    if (!pageVisible) return;
    
    fetchConnections();
    const intervalId = setInterval(fetchConnections, CONNECTIONS_UPDATE_INTERVAL);
    return () => clearInterval(intervalId);
  }, [pageVisible, fetchConnections]);

  // 检查是否支持调试
  useEffect(() => {
    isDebugEnabled().then((flag) => setIsDebug(flag));
  }, []);

  // 处理流量数据更新 - 使用节流控制更新频率
  const handleTrafficUpdate = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as ITrafficItem;
      if (
        data &&
        typeof data.up === "number" &&
        typeof data.down === "number"
      ) {
        // 使用节流控制更新频率
        const now = Date.now();
        if (now - lastUpdateRef.current.traffic < THROTTLE_TRAFFIC_UPDATE) {
          // 如果距离上次更新时间小于阈值，只更新图表不更新状态
          if (trafficRef.current) {
            trafficRef.current.appendData({
              up: data.up,
              down: data.down,
              timestamp: now,
            });
          }
          return;
        }
        
        // 更新最后更新时间
        lastUpdateRef.current.traffic = now;
        
        // 验证数据有效性，防止NaN
        const safeUp = isNaN(data.up) ? 0 : data.up;
        const safeDown = isNaN(data.down) ? 0 : data.down;
        
        // 批量更新状态
        setStats(prev => ({
          ...prev,
          traffic: { up: safeUp, down: safeDown }
        }));

        // 更新图表数据
        if (trafficRef.current) {
          trafficRef.current.appendData({
            up: safeUp,
            down: safeDown,
            timestamp: now,
          });
        }
      }
    } catch (err) {
      console.error("[Traffic] 解析数据错误:", err);
    }
  }, []);

  // 处理内存数据更新
  const handleMemoryUpdate = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as MemoryUsage;
      if (data && typeof data.inuse === "number") {
        setStats(prev => ({
          ...prev,
          memory: {
            inuse: isNaN(data.inuse) ? 0 : data.inuse,
            oslimit: data.oslimit,
          }
        }));
      }
    } catch (err) {
      console.error("[Memory] 解析数据错误:", err);
    }
  }, []);

  // 使用 WebSocket 连接获取数据 - 合并流量和内存连接逻辑
  useEffect(() => {
    if (!clashInfo || !pageVisible) return;

    const { server, secret = "" } = clashInfo;
    if (!server) return;

    // 清理现有连接的函数
    const cleanupSockets = () => {
      Object.values(socketRefs.current).forEach(socket => {
        if (socket) {
          socket.close();
        }
      });
      socketRefs.current = { traffic: null, memory: null };
    };

    // 关闭现有连接
    cleanupSockets();

    // 创建新连接
    socketRefs.current.traffic = createAuthSockette(`${server}/traffic`, secret, {
      onmessage: handleTrafficUpdate,
    });
    
    socketRefs.current.memory = createAuthSockette(`${server}/memory`, secret, {
      onmessage: handleMemoryUpdate,
    });

    return cleanupSockets;
  }, [clashInfo, pageVisible, handleTrafficUpdate, handleMemoryUpdate]);

  // 执行垃圾回收
  const handleGarbageCollection = useCallback(async () => {
    if (isDebug) {
      try {
        await gc();
        console.log("[Debug] 垃圾回收已执行");
      } catch (err) {
        console.error("[Debug] 垃圾回收失败:", err);
      }
    }
  }, [isDebug]);

  // 使用useMemo计算解析后的流量数据
  const parsedData = useMemo(() => {
    const [up, upUnit] = parseTraffic(stats.traffic.up);
    const [down, downUnit] = parseTraffic(stats.traffic.down);
    const [inuse, inuseUnit] = parseTraffic(stats.memory.inuse);
    const [uploadTotal, uploadTotalUnit] = parseTraffic(stats.connections.uploadTotal);
    const [downloadTotal, downloadTotalUnit] = parseTraffic(stats.connections.downloadTotal);
    
    return {
      up, upUnit, down, downUnit, inuse, inuseUnit,
      uploadTotal, uploadTotalUnit, downloadTotal, downloadTotalUnit
    };
  }, [stats]);

  // 渲染流量图表 - 使用useMemo缓存渲染结果
  const trafficGraphComponent = useMemo(() => {
    if (!trafficGraph || !pageVisible) return null;

    return (
      <Paper
        elevation={0}
        sx={{
          height: 130,
          cursor: "pointer",
          border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
          borderRadius: 2,
          overflow: "hidden",
        }}
        onClick={() => trafficRef.current?.toggleStyle()}
      >
        <div style={{ height: "100%", position: "relative" }}>
          <EnhancedTrafficGraph ref={trafficRef} />
          {isDebug && (
            <div
              style={{
                position: "absolute",
                top: "2px",
                left: "2px",
                zIndex: 10,
                backgroundColor: "rgba(0,0,0,0.5)",
                color: "white",
                fontSize: "8px",
                padding: "2px 4px",
                borderRadius: "4px",
              }}
            >
              DEBUG: {!!trafficRef.current ? "图表已初始化" : "图表未初始化"}
              <br />
              {new Date().toISOString().slice(11, 19)}
            </div>
          )}
        </div>
      </Paper>
    );
  }, [trafficGraph, pageVisible, theme.palette.divider, isDebug]);

  // 使用useMemo计算统计卡片配置
  const statCards = useMemo(() => [
    {
      icon: <ArrowUpwardRounded fontSize="small" />,
      title: t("Upload Speed"),
      value: parsedData.up,
      unit: `${parsedData.upUnit}/s`,
      color: "secondary" as const,
    },
    {
      icon: <ArrowDownwardRounded fontSize="small" />,
      title: t("Download Speed"),
      value: parsedData.down,
      unit: `${parsedData.downUnit}/s`,
      color: "primary" as const,
    },
    {
      icon: <LinkRounded fontSize="small" />,
      title: t("Active Connections"),
      value: stats.connections.activeConnections,
      unit: "",
      color: "success" as const,
    },
    {
      icon: <CloudUploadRounded fontSize="small" />,
      title: t("Uploaded"),
      value: parsedData.uploadTotal,
      unit: parsedData.uploadTotalUnit,
      color: "secondary" as const,
    },
    {
      icon: <CloudDownloadRounded fontSize="small" />,
      title: t("Downloaded"),
      value: parsedData.downloadTotal,
      unit: parsedData.downloadTotalUnit,
      color: "primary" as const,
    },
    {
      icon: <MemoryRounded fontSize="small" />,
      title: t("Memory Usage"),
      value: parsedData.inuse,
      unit: parsedData.inuseUnit,
      color: "error" as const,
      onClick: isDebug ? handleGarbageCollection : undefined,
    },
  ], [t, parsedData, stats.connections.activeConnections, isDebug, handleGarbageCollection]);

  return (
    <Grid container spacing={1} columns={{ xs: 8, sm: 8, md: 12 }}>
      <Grid size={12}>
        {/* 流量图表区域 */}
        {trafficGraphComponent}
      </Grid>
      {/* 统计卡片区域 */}
      {statCards.map((card, index) => (
        <Grid key={index} size={4}>
          <CompactStatCard {...card} />
        </Grid>
      ))}
    </Grid>
  );
};
