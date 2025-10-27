import { Box, Typography, alpha, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

interface NetworkProtocolProps {
  protocolStats: { tcp: number; udp: number };
}

export const NetworkProtocol = ({ protocolStats }: NetworkProtocolProps) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const total = protocolStats.tcp + protocolStats.udp;
  const tcpPercent = total > 0 ? (protocolStats.tcp / total) * 100 : 0;
  const udpPercent = total > 0 ? (protocolStats.udp / total) * 100 : 0;

  const protocols = [
    {
      name: "TCP",
      count: protocolStats.tcp,
      percent: tcpPercent,
      color: theme.palette.primary.main,
    },
    {
      name: "UDP",
      count: protocolStats.udp,
      percent: udpPercent,
      color: theme.palette.warning.main,
    },
  ];

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        p: 2,
      }}
    >
      {/* 饼图可视化 */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          mb: 2,
          position: "relative",
          height: 140,
        }}
      >
        <Box
          sx={{
            width: 140,
            height: 140,
            borderRadius: "50%",
            background: `conic-gradient(
              ${protocols[0].color} 0% ${protocols[0].percent}%,
              ${protocols[1].color} ${protocols[0].percent}% 100%
            )`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <Box
            sx={{
              width: 90,
              height: 90,
              borderRadius: "50%",
              backgroundColor:
                theme.palette.mode === "dark" ? "#282a36" : "#ffffff",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography variant="h5" fontWeight="bold">
              {total}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("Total")}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* 协议统计列表 */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {protocols.map((protocol) => (
          <Box
            key={protocol.name}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 1.5,
              borderRadius: 1,
              backgroundColor: alpha(protocol.color, 0.08),
              border: `1px solid ${alpha(protocol.color, 0.2)}`,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: protocol.color,
                }}
              />
              <Typography variant="body2" fontWeight="medium">
                {protocol.name}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {protocol.count} {t("Connections")}
              </Typography>
              <Typography
                variant="body2"
                fontWeight="bold"
                sx={{ color: protocol.color }}
              >
                {protocol.percent.toFixed(1)}%
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
