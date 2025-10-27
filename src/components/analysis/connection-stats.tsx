import { Box, Typography, alpha, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import parseTraffic from "@/utils/parse-traffic";

interface ConnectionStatsProps {
  totalConnections: number;
  uploadTotal: number;
  downloadTotal: number;
}

export const ConnectionStats = ({
  totalConnections,
  uploadTotal,
  downloadTotal,
}: ConnectionStatsProps) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const stats = [
    {
      label: t("Active Connections"),
      value: totalConnections.toString(),
      color: theme.palette.primary.main,
    },
    {
      label: t("Total Upload"),
      value: parseTraffic(uploadTotal),
      color: theme.palette.error.main,
    },
    {
      label: t("Total Download"),
      value: parseTraffic(downloadTotal),
      color: theme.palette.success.main,
    },
    {
      label: t("Total Traffic"),
      value: parseTraffic(uploadTotal + downloadTotal),
      color: theme.palette.info.main,
    },
  ];

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
        gap: 2,
      }}
    >
      {stats.map((stat) => (
        <Box
          key={stat.label}
          sx={{
            p: 2,
            borderRadius: 2,
            backgroundColor: alpha(stat.color, 0.08),
            border: `1px solid ${alpha(stat.color, 0.2)}`,
            textAlign: "center",
          }}
        >
          <Typography
            variant="h4"
            fontWeight="bold"
            sx={{ color: stat.color, mb: 0.5 }}
          >
            {stat.value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stat.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};
