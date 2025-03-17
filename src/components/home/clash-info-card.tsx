import { useTranslation } from "react-i18next";
import { Typography, Stack, Divider } from "@mui/material";
import { DeveloperBoardOutlined } from "@mui/icons-material";
import { useClashInfo } from "@/hooks/use-clash";
import { useClash } from "@/hooks/use-clash";
import { EnhancedCard } from "./enhanced-card";
import useSWR from "swr";
import { getRules } from "@/services/api";
import { getAppUptime } from "@/services/cmds";
import { useMemo } from "react";

// 将毫秒转换为时:分:秒格式的函数
const formatUptime = (uptimeMs: number) => {
  const hours = Math.floor(uptimeMs / 3600000);
  const minutes = Math.floor((uptimeMs % 3600000) / 60000);
  const seconds = Math.floor((uptimeMs % 60000) / 1000);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export const ClashInfoCard = () => {
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const { version: clashVersion } = useClash();

  // 使用SWR获取应用运行时间，降低更新频率
  const { data: uptimeMs = 0 } = useSWR(
    "appUptime",
    getAppUptime,
    {
      refreshInterval: 1000,
      revalidateOnFocus: false,
      dedupingInterval: 1000,
    },
  );

  // 使用useMemo缓存格式化后的uptime，避免频繁计算
  const uptime = useMemo(() => formatUptime(uptimeMs), [uptimeMs]);

  // 获取规则数据，只在组件加载时获取一次
  const { data: rules = [] } = useSWR("getRules", getRules, {
    revalidateOnFocus: false,
    errorRetryCount: 2,
  });

  // 使用备忘录组件内容，减少重新渲染
  const cardContent = useMemo(() => {
    if (!clashInfo) return null;
    
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
            {clashInfo.server || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Mixed Port")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {clashInfo.mixed_port || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("Uptime")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {uptime}
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
  }, [clashInfo, clashVersion, t, uptime, rules.length]);

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
