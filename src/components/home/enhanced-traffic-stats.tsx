import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Typography,
  Paper,
  alpha,
  useTheme,
  PaletteColor,
  Grid,
} from "@mui/material";
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
import { useAppData } from "@/providers/app-data-provider";

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
const CompactStatCard = memo(
  ({ icon, title, value, unit, color, onClick }: StatCardProps) => {
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
          "&:hover": onClick
            ? {
                bgcolor: alpha(colorValue, 0.1),
                border: `1px solid ${alpha(colorValue, 0.3)}`,
                boxShadow: `0 4px 8px rgba(0,0,0,0.05)`,
              }
            : {},
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
          <Grid
            component="div"
            sx={{ display: "flex", alignItems: "baseline" }}
          >
            <Typography
              variant="body1"
              fontWeight="bold"
              noWrap
              sx={{ mr: 0.5 }}
            >
              {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {unit}
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    );
  },
);

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

  // 使用AppDataProvider
  const { connections, uptime } = useAppData();

  // 使用单一状态对象减少状态更新次数
  const [stats, setStats] = useState({
    traffic: { up: 0, down: 0 },
    memory: { inuse: 0, oslimit: undefined as number | undefined },
  });

  // 创建一个标记来追踪最后更新时间，用于节流
  const lastUpdateRef = useRef({ traffic: 0 });

  // 是否显示流量图表
  const trafficGraph = verge?.traffic_graph ?? true;

  // WebSocket引用
  const socketRefs = useRef<{
    traffic: ReturnType<typeof createAuthSockette> | null;
    memory: ReturnType<typeof createAuthSockette> | null;
  }>({
    traffic: null,
    memory: null,
  });

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
          try {
            trafficRef.current?.appendData({
              up: data.up,
              down: data.down,
              timestamp: now,
            });
          } catch {}
          return;
        }
        lastUpdateRef.current.traffic = now;
        const safeUp = isNaN(data.up) ? 0 : data.up;
        const safeDown = isNaN(data.down) ? 0 : data.down;
        try {
          setStats((prev) => ({
            ...prev,
            traffic: { up: safeUp, down: safeDown },
          }));
        } catch {}
        try {
          trafficRef.current?.appendData({
            up: safeUp,
            down: safeDown,
            timestamp: now,
          });
        } catch {}
      }
    } catch (err) {
      console.error("[Traffic] 解析数据错误:", err, event.data);
    }
  }, []);

  // 处理内存数据更新
  const handleMemoryUpdate = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as MemoryUsage;
      if (data && typeof data.inuse === "number") {
        setStats((prev) => ({
          ...prev,
          memory: {
            inuse: isNaN(data.inuse) ? 0 : data.inuse,
            oslimit: data.oslimit,
          },
        }));
      }
    } catch (err) {
      console.error("[Memory] 解析数据错误:", err, event.data);
    }
  }, []);

  // 使用 WebSocket 连接获取数据 - 合并流量和内存连接逻辑
  useEffect(() => {
    if (!clashInfo || !pageVisible) return;

    const { server, secret = "" } = clashInfo;
    if (!server) return;

    // 清理现有连接的函数
    const cleanupSockets = () => {
      Object.values(socketRefs.current).forEach((socket) => {
        if (socket) {
          socket.close();
        }
      });
      socketRefs.current = { traffic: null, memory: null };
    };

    // 关闭现有连接
    cleanupSockets();

    // 创建新连接
    console.log(
      `[Traffic][${EnhancedTrafficStats.name}] 正在连接: ${server}/traffic`,
    );
    socketRefs.current.traffic = createAuthSockette(
      `${server}/traffic`,
      secret,
      {
        onmessage: handleTrafficUpdate,
        onopen: (event) => {
          console.log(
            `[Traffic][${EnhancedTrafficStats.name}] WebSocket 连接已建立`,
            event,
          );
        },
        onerror: (event) => {
          console.error(
            `[Traffic][${EnhancedTrafficStats.name}] WebSocket 连接错误或达到最大重试次数`,
            event,
          );
          setStats((prev) => ({ ...prev, traffic: { up: 0, down: 0 } }));
        },
        onclose: (event) => {
          console.log(
            `[Traffic][${EnhancedTrafficStats.name}] WebSocket 连接关闭`,
            event.code,
            event.reason,
          );
          if (event.code !== 1000 && event.code !== 1001) {
            console.warn(
              `[Traffic][${EnhancedTrafficStats.name}] 连接非正常关闭，重置状态`,
            );
            setStats((prev) => ({ ...prev, traffic: { up: 0, down: 0 } }));
          }
        },
      },
    );

    console.log(
      `[Memory][${EnhancedTrafficStats.name}] 正在连接: ${server}/memory`,
    );
    socketRefs.current.memory = createAuthSockette(`${server}/memory`, secret, {
      onmessage: handleMemoryUpdate,
      onopen: (event) => {
        console.log(
          `[Memory][${EnhancedTrafficStats.name}] WebSocket 连接已建立`,
          event,
        );
      },
      onerror: (event) => {
        console.error(
          `[Memory][${EnhancedTrafficStats.name}] WebSocket 连接错误或达到最大重试次数`,
          event,
        );
        setStats((prev) => ({
          ...prev,
          memory: { inuse: 0, oslimit: undefined },
        }));
      },
      onclose: (event) => {
        console.log(
          `[Memory][${EnhancedTrafficStats.name}] WebSocket 连接关闭`,
          event.code,
          event.reason,
        );
        if (event.code !== 1000 && event.code !== 1001) {
          console.warn(
            `[Memory][${EnhancedTrafficStats.name}] 连接非正常关闭，重置状态`,
          );
          setStats((prev) => ({
            ...prev,
            memory: { inuse: 0, oslimit: undefined },
          }));
        }
      },
    });

    return cleanupSockets;
  }, [clashInfo, pageVisible, handleTrafficUpdate, handleMemoryUpdate]);

  // 组件卸载时清理所有定时器/引用
  useEffect(() => {
    return () => {
      try {
        Object.values(socketRefs.current).forEach((socket) => {
          if (socket) socket.close();
        });
        socketRefs.current = { traffic: null, memory: null };
      } catch {}
    };
  }, []);

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
    const [uploadTotal, uploadTotalUnit] = parseTraffic(
      connections.uploadTotal,
    );
    const [downloadTotal, downloadTotalUnit] = parseTraffic(
      connections.downloadTotal,
    );

    return {
      up,
      upUnit,
      down,
      downUnit,
      inuse,
      inuseUnit,
      uploadTotal,
      uploadTotalUnit,
      downloadTotal,
      downloadTotalUnit,
      connectionsCount: connections.count,
    };
  }, [stats, connections]);

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
  const statCards = useMemo(
    () => [
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
        value: parsedData.connectionsCount,
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
    ],
    [t, parsedData, isDebug, handleGarbageCollection],
  );

  return (
    <Grid container spacing={1} columns={{ xs: 8, sm: 8, md: 12 }}>
      {trafficGraph && (
        <Grid size={12}>
          {/* 流量图表区域 */}
          {trafficGraphComponent}
        </Grid>
      )}
      {/* 统计卡片区域 */}
      {statCards.map((card, index) => (
        <Grid key={index} size={4}>
          <CompactStatCard {...card} />
        </Grid>
      ))}
    </Grid>
  );
};
