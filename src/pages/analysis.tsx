import {
  BarChartRounded,
  NetworkCheckRounded,
  PieChartOutlined,
  RefreshRounded,
  TrendingUpRounded,
} from "@mui/icons-material";
import { Box, Button, Grid, IconButton } from "@mui/material";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useLockFn } from "ahooks";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConnectionStats } from "@/components/analysis/connection-stats";
import { HostRanking } from "@/components/analysis/host-ranking";
import { NetworkProtocol } from "@/components/analysis/network-protocol";
import { ProcessRanking } from "@/components/analysis/process-ranking";
import { RuleMatchStats } from "@/components/analysis/rule-match-stats";
import { BasePage } from "@/components/base";
import { EnhancedCard } from "@/components/home/enhanced-card";
import { useConnectionData } from "@/hooks/use-connection-data";
import { useVisibility } from "@/hooks/use-visibility";
import { showNotice } from "@/services/noticeService";

const AnalysisPage = () => {
  const { t } = useTranslation();
  const pageVisible = useVisibility();
  const { response, refreshGetClashConnection } = useConnectionData();
  const { data: connections } = response;

  const [refreshKey, setRefreshKey] = useState(0);

  // 强制刷新数据
  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
    refreshGetClashConnection();
  }, [refreshGetClashConnection]);

  // 统计数据处理（实时更新）
  const analysisData = useMemo(() => {
    // refreshKey 用于强制刷新
    void refreshKey;

    if (!connections?.connections || !pageVisible) {
      return {
        hostStats: new Map<
          string,
          { upload: number; download: number; count: number }
        >(),
        processStats: new Map<
          string,
          { upload: number; download: number; count: number }
        >(),
        protocolStats: { tcp: 0, udp: 0 },
        ruleStats: new Map<string, number>(),
        totalConnections: 0,
      };
    }

    const hostStats = new Map<
      string,
      { upload: number; download: number; count: number }
    >();
    const processStats = new Map<
      string,
      { upload: number; download: number; count: number }
    >();
    const protocolStats = { tcp: 0, udp: 0 };
    const ruleStats = new Map<string, number>();

    // 统计所有活跃连接
    connections.connections.forEach((conn) => {
      const { host, process, network } = conn.metadata;
      const { upload, download, rule } = conn;

      // 统计主机流量（使用累计流量）
      if (host) {
        const existing = hostStats.get(host) || {
          upload: 0,
          download: 0,
          count: 0,
        };
        hostStats.set(host, {
          upload: existing.upload + upload,
          download: existing.download + download,
          count: existing.count + 1,
        });
      }

      // 统计进程流量（使用累计流量）
      if (process) {
        const existing = processStats.get(process) || {
          upload: 0,
          download: 0,
          count: 0,
        };
        processStats.set(process, {
          upload: existing.upload + upload,
          download: existing.download + download,
          count: existing.count + 1,
        });
      }

      // 统计协议分布
      if (network?.toLowerCase() === "tcp") {
        protocolStats.tcp++;
      } else if (network?.toLowerCase() === "udp") {
        protocolStats.udp++;
      }

      // 统计规则匹配
      if (rule) {
        ruleStats.set(rule, (ruleStats.get(rule) || 0) + 1);
      }
    });

    return {
      hostStats,
      processStats,
      protocolStats,
      ruleStats,
      totalConnections: connections.connections.length,
    };
  }, [connections, pageVisible, refreshKey]);

  // 导出报告
  const handleExportReport = useLockFn(async () => {
    if (!connections) return;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const savePath = await save({
        defaultPath: `traffic-analysis-${timestamp}.json`,
        filters: [
          {
            name: "JSON",
            extensions: ["json"],
          },
        ],
      });

      if (!savePath || Array.isArray(savePath)) {
        return;
      }

      const reportData = {
        exportTime: new Date().toLocaleString("zh-CN"),
        summary: {
          totalConnections: analysisData.totalConnections,
          uploadTotal: connections.uploadTotal,
          downloadTotal: connections.downloadTotal,
        },
        hosts: Array.from(analysisData.hostStats.entries())
          .map(([host, stats]) => ({
            host,
            upload: stats.upload,
            download: stats.download,
            total: stats.upload + stats.download,
            count: stats.count,
          }))
          .sort((a, b) => b.total - a.total),
        processes: Array.from(analysisData.processStats.entries())
          .map(([process, stats]) => ({
            process,
            upload: stats.upload,
            download: stats.download,
            total: stats.upload + stats.download,
            count: stats.count,
          }))
          .sort((a, b) => b.total - a.total),
        protocols: {
          tcp: analysisData.protocolStats.tcp,
          udp: analysisData.protocolStats.udp,
        },
        rules: Array.from(analysisData.ruleStats.entries())
          .map(([rule, count]) => ({
            rule,
            count,
          }))
          .sort((a, b) => b.count - a.count),
      };

      await writeTextFile(savePath, JSON.stringify(reportData, null, 2));
      showNotice("success", t("Report Exported Successfully"));
    } catch (error) {
      console.error("Export error:", error);
      showNotice("error", t("Report Export Failed"));
    }
  });

  return (
    <BasePage
      title={t("Traffic Analysis")}
      contentStyle={{ padding: 2 }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton onClick={handleRefresh} size="small" color="inherit">
            <RefreshRounded />
          </IconButton>
          <Button size="small" variant="contained" onClick={handleExportReport}>
            <span style={{ whiteSpace: "nowrap" }}>{t("Export Report")}</span>
          </Button>
        </Box>
      }
    >
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        {/* 连接统计概览 */}
        <Grid size={12}>
          <EnhancedCard
            title={t("Connection Overview")}
            icon={<TrendingUpRounded />}
            iconColor="primary"
          >
            <ConnectionStats
              totalConnections={analysisData.totalConnections}
              uploadTotal={connections?.uploadTotal || 0}
              downloadTotal={connections?.downloadTotal || 0}
            />
          </EnhancedCard>
        </Grid>

        {/* 主机排行 */}
        <Grid size={6}>
          <EnhancedCard
            title={t("Top Hosts")}
            icon={<BarChartRounded />}
            iconColor="info"
            noContentPadding
          >
            <HostRanking hostStats={analysisData.hostStats} />
          </EnhancedCard>
        </Grid>

        {/* 进程排行 */}
        <Grid size={6}>
          <EnhancedCard
            title={t("Top Processes")}
            icon={<BarChartRounded />}
            iconColor="success"
            noContentPadding
          >
            <ProcessRanking processStats={analysisData.processStats} />
          </EnhancedCard>
        </Grid>

        {/* 协议分析 */}
        <Grid size={6}>
          <EnhancedCard
            title={t("Protocol Distribution")}
            icon={<PieChartOutlined />}
            iconColor="warning"
          >
            <NetworkProtocol protocolStats={analysisData.protocolStats} />
          </EnhancedCard>
        </Grid>

        {/* 规则匹配统计 */}
        <Grid size={6}>
          <EnhancedCard
            title={t("Rule Match Statistics")}
            icon={<NetworkCheckRounded />}
            iconColor="secondary"
            noContentPadding
          >
            <RuleMatchStats ruleStats={analysisData.ruleStats} />
          </EnhancedCard>
        </Grid>
      </Grid>
    </BasePage>
  );
};

export default AnalysisPage;
