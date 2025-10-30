import { ArrowDownwardRounded, ArrowUpwardRounded } from "@mui/icons-material";
import { Box, Chip, LinearProgress, Typography } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { BaseEmpty } from "@/components/base";
import parseTraffic from "@/utils/parse-traffic";

interface ProcessRankingProps {
  processStats: Map<
    string,
    { upload: number; download: number; count: number }
  >;
}

export const ProcessRanking = ({ processStats }: ProcessRankingProps) => {
  const { t } = useTranslation();

  // 按总流量排序，取前10
  const topProcesses = useMemo(() => {
    const processes = Array.from(processStats.entries()).map(
      ([process, stats]) => ({
        process,
        total: stats.upload + stats.download,
        upload: stats.upload,
        download: stats.download,
        count: stats.count,
      }),
    );

    return processes.sort((a, b) => b.total - a.total).slice(0, 10);
  }, [processStats]);

  const maxTraffic = topProcesses[0]?.total || 1;

  if (topProcesses.length === 0) {
    return (
      <Box sx={{ minHeight: 200, py: 4 }}>
        <BaseEmpty text={t("No Data")} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxHeight: 380, overflow: "auto" }}>
      {topProcesses.map((item, index) => (
        <Box
          key={item.process}
          sx={{
            mb: 2,
            pb: 2,
            borderBottom:
              index < topProcesses.length - 1 ? "1px solid" : "none",
            borderColor: "divider",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 1,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                flex: 1,
                minWidth: 0,
              }}
            >
              <Chip
                label={`#${index + 1}`}
                size="small"
                color={index === 0 ? "success" : "default"}
                sx={{ mr: 1, minWidth: 40 }}
              />
              <Typography
                variant="body2"
                fontWeight="medium"
                noWrap
                sx={{ flex: 1, minWidth: 0 }}
                title={item.process}
              >
                {item.process}
              </Typography>
            </Box>
            <Typography variant="body2" fontWeight="bold" sx={{ ml: 1 }}>
              {parseTraffic(item.total)}
            </Typography>
          </Box>

          <LinearProgress
            variant="determinate"
            value={(item.total / maxTraffic) * 100}
            color="success"
            sx={{ mb: 1, height: 6, borderRadius: 1 }}
          />

          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <ArrowUpwardRounded sx={{ fontSize: 14, color: "error.main" }} />
              <Typography variant="caption" color="text.secondary">
                {parseTraffic(item.upload)}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <ArrowDownwardRounded
                sx={{ fontSize: 14, color: "success.main" }}
              />
              <Typography variant="caption" color="text.secondary">
                {parseTraffic(item.download)}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ ml: "auto" }}
            >
              {t("Connections")}: {item.count}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
};
