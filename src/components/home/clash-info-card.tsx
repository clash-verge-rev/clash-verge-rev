import { DeveloperBoardOutlined } from "@mui/icons-material";
import { Divider, Stack, Typography } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useClash } from "@/hooks/use-clash";
import {
  useAppUptime,
  useClashConfig,
  useRulesData,
  useSystemProxyAddress,
  useSystemProxyData,
} from "@/hooks/use-clash-data";

import { EnhancedCard } from "./enhanced-card";

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
  const { clashConfig } = useClashConfig();
  const { sysproxy } = useSystemProxyData();
  const { rules } = useRulesData();
  const { uptime } = useAppUptime();
  const systemProxyAddress = useSystemProxyAddress({
    clashConfig,
    sysproxy,
  });

  // 使用useMemo缓存格式化后的uptime，避免频繁计算
  const formattedUptime = useMemo(() => formatUptime(uptime), [uptime]);

  // 使用备忘录组件内容，减少重新渲染
  const cardContent = useMemo(() => {
    if (!clashConfig) return null;

    return (
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("home.components.clashInfo.fields.coreVersion")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {clashVersion || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("home.components.clashInfo.fields.systemProxyAddress")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {systemProxyAddress}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("home.components.clashInfo.fields.mixedPort")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {clashConfig.mixedPort || "-"}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("home.components.clashInfo.fields.uptime")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {formattedUptime}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {t("home.components.clashInfo.fields.rulesCount")}
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {rules.length}
          </Typography>
        </Stack>
      </Stack>
    );
  }, [
    clashConfig,
    clashVersion,
    t,
    formattedUptime,
    rules.length,
    systemProxyAddress,
  ]);

  return (
    <EnhancedCard
      title={t("home.components.clashInfo.title")}
      icon={<DeveloperBoardOutlined />}
      iconColor="warning"
      action={null}
    >
      {cardContent}
    </EnhancedCard>
  );
};
