import { useTranslation } from "react-i18next";
import { Typography, Stack, Divider } from "@mui/material";
import { DeveloperBoardOutlined } from "@mui/icons-material";
import { useClash } from "@/hooks/use-clash";
import { EnhancedCard } from "./enhanced-card";
import { useMemo } from "react";
import { useAppData } from "@/providers/app-data-provider";

// 将毫秒转换为时:分:秒格式的函数
const formatUptime = (uptimeMs: number) => {
  const hours = Math.floor(uptimeMs / 3600000);
  const minutes = Math.floor((uptimeMs % 3600000) / 60000);
  const seconds = Math.floor((uptimeMs % 60000) / 1000);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export const ClashInfoCard = () => {
  const { t } = useTranslation();
  const { version: clashVersion } = useClash();
  const { clashConfig, sysproxy, rules, uptime } = useAppData();

  // 使用useMemo缓存格式化后的uptime，避免频繁计算
  const formattedUptime = useMemo(() => formatUptime(uptime), [uptime]);

  // 使用备忘录组件内容，减少重新渲染
  const cardContent = useMemo(() => {
    if (!clashConfig) return null;

    return (
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Core Version")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {clashVersion || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("System Proxy Address")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {sysproxy?.server || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Mixed Port")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {clashConfig["mixed-port"] || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Uptime")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {formattedUptime}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Rules Count")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {rules.length}
          </Typography>
        </Stack>
      </Stack>
    );
  }, [clashConfig, clashVersion, t, formattedUptime, rules.length, sysproxy]);

  return (
    <EnhancedCard
      title={t("Clash Info")}
      icon={<DeveloperBoardOutlined />}
      iconColor="warning"
      action={null}
    >
      {cardContent}
    </EnhancedCard>
  );
};
