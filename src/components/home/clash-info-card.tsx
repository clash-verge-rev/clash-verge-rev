import { useTranslation } from "react-i18next";
import { Typography, Stack, Divider } from "@mui/material";
import { DeveloperBoardOutlined } from "@mui/icons-material";
import { useClashInfo } from "@/hooks/use-clash";
import { useClash } from "@/hooks/use-clash";
import { EnhancedCard } from "./enhanced-card";
import useSWR from "swr";
import { getRules } from "@/services/api";
import { getAppUptime } from "@/services/cmds";
import { useState } from "react";

export const ClashInfoCard = () => {
  const { t } = useTranslation();
  const { clashInfo } = useClashInfo();
  const { version: clashVersion } = useClash();

  // 计算运行时间
  const [uptime, setUptime] = useState("0:00:00");

  // 使用SWR定期获取应用运行时间
  useSWR(
    "appUptime",
    async () => {
      const uptimeMs = await getAppUptime();
      // 将毫秒转换为时:分:秒格式
      const hours = Math.floor(uptimeMs / 3600000);
      const minutes = Math.floor((uptimeMs % 3600000) / 60000);
      const seconds = Math.floor((uptimeMs % 60000) / 1000);
      setUptime(
        `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
      );
      return uptimeMs;
    },
    {
      refreshInterval: 1000, // 每秒更新一次
      revalidateOnFocus: false,
      dedupingInterval: 500,
    },
  );

  // 获取规则数
  const { data: rulesData } = useSWR("getRules", getRules, {
    fallbackData: [],
    suspense: false,
    revalidateOnFocus: false,
    errorRetryCount: 2,
  });

  // 获取规则数据
  const rules = rulesData || [];

  return (
    <EnhancedCard
      title={t("Clash Info")}
      icon={<DeveloperBoardOutlined />}
      iconColor="warning"
      action={null}
    >
      {clashInfo && (
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
      )}
    </EnhancedCard>
  );
};
