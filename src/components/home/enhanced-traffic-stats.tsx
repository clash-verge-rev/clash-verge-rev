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
import parseTraffic from "@/utils/parse-traffic";
import {
  isDebugEnabled,
  gc,
  getTrafficData,
  getMemoryData,
  getSystemMonitorOverview,
} from "@/services/cmds";
import { ReactNode } from "react";
import { useAppData } from "@/providers/app-data-provider";
import useSWR from "swr";

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

  // 使用AppDataProvider
  const { connections, uptime } = useAppData();

  // 使用单一状态对象减少状态更新次数
  const [stats, setStats] = useState({
    traffic: { up: 0, down: 0 },
    memory: { inuse: 0, oslimit: undefined as number | undefined },
  });

  // 是否显示流量图表
  const trafficGraph = verge?.traffic_graph ?? true;

  // 检查是否支持调试
  // TODO: merge this hook with layout-traffic.tsx
  const { data: isDebug } = useSWR(
    `clash-verge-rev-internal://isDebugEnabled`,
    () => isDebugEnabled(),
    {
      // default value before is fetched
      fallbackData: false,
    },
  );

  // 使用系统监控概览 API 一次性获取所有数据
  const { data: monitorData } = useSWR<ISystemMonitorOverview>(
    clashInfo && pageVisible ? "getSystemMonitorOverview" : null,
    getSystemMonitorOverview,
    {
      refreshInterval: 1000, // 1秒刷新一次
      keepPreviousData: true,
      onSuccess: (data) => {
        console.log(
          "[Monitor][EnhancedTrafficStats] IPC 获取到监控数据:",
          data,
        );
        if (data) {
          // 使用速率数据而不是总量
          const safeUp = isNaN(data.traffic.raw.up_rate)
            ? 0
            : data.traffic.raw.up_rate;
          const safeDown = isNaN(data.traffic.raw.down_rate)
            ? 0
            : data.traffic.raw.down_rate;
          const safeInuse = isNaN(data.memory.raw.inuse)
            ? 0
            : data.memory.raw.inuse;
          const safeOslimit = isNaN(data.memory.raw.oslimit)
            ? undefined
            : data.memory.raw.oslimit;

          console.log("[Monitor][EnhancedTrafficStats] 处理后的数据:", {
            up: safeUp,
            down: safeDown,
            inuse: safeInuse,
            oslimit: safeOslimit,
          });

          setStats({
            traffic: { up: safeUp, down: safeDown },
            memory: { inuse: safeInuse, oslimit: safeOslimit },
          });

          // 为图表添加数据
          if (trafficRef.current) {
            trafficRef.current.appendData({
              up: safeUp,
              down: safeDown,
              timestamp: Date.now(),
            });
          }
        }
      },
      onError: (error) => {
        console.error(
          "[Monitor][EnhancedTrafficStats] IPC 获取数据错误:",
          error,
        );
        setStats({
          traffic: { up: 0, down: 0 },
          memory: { inuse: 0, oslimit: undefined },
        });
      },
    },
  );

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
              状态: {monitorData?.overall_status || "unknown"}
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
