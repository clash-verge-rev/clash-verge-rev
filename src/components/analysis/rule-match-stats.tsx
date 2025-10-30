import { Box, Chip, LinearProgress, Typography } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { BaseEmpty } from "@/components/base";

interface RuleMatchStatsProps {
  ruleStats: Map<string, number>;
}

export const RuleMatchStats = ({ ruleStats }: RuleMatchStatsProps) => {
  const { t } = useTranslation();

  // 按匹配次数排序
  const topRules = useMemo(() => {
    const rules = Array.from(ruleStats.entries()).map(([rule, count]) => ({
      rule,
      count,
    }));

    return rules.sort((a, b) => b.count - a.count).slice(0, 10);
  }, [ruleStats]);

  const maxCount = topRules[0]?.count || 1;
  const totalCount = useMemo(
    () => Array.from(ruleStats.values()).reduce((sum, count) => sum + count, 0),
    [ruleStats],
  );

  if (topRules.length === 0) {
    return (
      <Box sx={{ minHeight: 200, py: 4 }}>
        <BaseEmpty text={t("No Data")} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxHeight: 300, overflow: "auto" }}>
      {topRules.map((item, index) => (
        <Box
          key={item.rule}
          sx={{
            mb: 2,
            pb: 2,
            borderBottom: index < topRules.length - 1 ? "1px solid" : "none",
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
                color={index < 3 ? "secondary" : "default"}
                sx={{ mr: 1, minWidth: 40 }}
              />
              <Typography
                variant="body2"
                fontWeight="medium"
                noWrap
                sx={{ flex: 1, minWidth: 0 }}
                title={item.rule}
              >
                {item.rule}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: 1 }}>
              <Typography variant="body2" fontWeight="bold">
                {item.count}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ({((item.count / totalCount) * 100).toFixed(1)}%)
              </Typography>
            </Box>
          </Box>

          <LinearProgress
            variant="determinate"
            value={(item.count / maxCount) * 100}
            color="secondary"
            sx={{ height: 6, borderRadius: 1 }}
          />
        </Box>
      ))}
    </Box>
  );
};
