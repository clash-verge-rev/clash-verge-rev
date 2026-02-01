import {
  LocationOnOutlined,
  RefreshOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import { Box, Button, IconButton, Skeleton, Typography } from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "foxact/use-abortable-effect";
import { memo, useCallback, useState, useEffectEvent, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

import { getIpInfo } from "@/services/api";

import { EnhancedCard } from "./enhanced-card";

// 定义刷新时间（秒）
const IP_REFRESH_SECONDS = 300;
const IP_INFO_CACHE_KEY = "cv_ip_info_cache";

const InfoItem = memo(({ label, value }: { label: string; value?: string }) => (
  <Box sx={{ mb: 0.7, display: "flex", alignItems: "flex-start" }}>
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ minwidth: 60, mr: 0.5, flexShrink: 0, textAlign: "right" }}
    >
      {label}:
    </Typography>
    <Typography
      variant="body2"
      sx={{
        ml: 0.5,
        overflow: "hidden",
        textOverflow: "ellipsis",
        wordBreak: "break-word",
        whiteSpace: "normal",
        flexGrow: 1,
      }}
    >
      {value || "Unknown"}
    </Typography>
  </Box>
));

// 获取国旗表情
const getCountryFlag = (countryCode: string | undefined) => {
  if (!countryCode) return "";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

// IP信息卡片组件
export const IpInfoCard = () => {
  const { t } = useTranslation();
  const [showIp, setShowIp] = useState(false);
  const appWindow = useMemo(() => getCurrentWebviewWindow(), []);

  const [countdown, setCountdown] = useState(IP_REFRESH_SECONDS);

  const {
    data: ipInfo,
    error,
    isLoading,
    mutate,
  } = useSWR(IP_INFO_CACHE_KEY, getIpInfo, {
    refreshInterval: 0,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    shouldRetryOnError: true,
  });

  // function useEffectEvent
  const onCountdownTick = useEffectEvent(async () => {
    const now = Date.now();
    const ts = ipInfo?.lastFetchTs;
    if (!ts) {
      return;
    }

    const elapsed = Math.floor((now - ts) / 1000);
    const remaining = IP_REFRESH_SECONDS - elapsed;

    if (remaining <= 0) {
      if (navigator.onLine && (await appWindow.isVisible())) {
        mutate();
        setCountdown(IP_REFRESH_SECONDS);
      } else {
        // do nothing. we even skip "setCountdown" to reduce re-renders
        //
        // but the remaining time still <= 0, and setInterval is not stopped, this
        // callback will still be regularly triggered, as soon as the window is visible
        // or network online again, we mutate() immediately in the following tick.
      }
    } else {
      setCountdown(remaining);
    }
  });

  // Countdown / refresh scheduler — updates UI every 1s and triggers immediate revalidation when expired
  useEffect(() => {
    const timer: number | null = window.setInterval(onCountdownTick, 1000);
    return () => {
      if (timer != null) clearInterval(timer);
    };
  }, [mutate]);

  const toggleShowIp = useCallback(() => {
    setShowIp((prev) => !prev);
  }, []);

  // Loading
  if (isLoading) {
    return (
      <EnhancedCard
        title={t("home.components.ipInfo.title")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        action={
          <IconButton size="small" onClick={() => mutate()} disabled>
            <RefreshOutlined />
          </IconButton>
        }
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Skeleton variant="text" width="60%" height={30} />
          <Skeleton variant="text" width="80%" height={24} />
          <Skeleton variant="text" width="70%" height={24} />
          <Skeleton variant="text" width="50%" height={24} />
        </Box>
      </EnhancedCard>
    );
  }

  // Error
  if (error) {
    return (
      <EnhancedCard
        title={t("home.components.ipInfo.title")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        action={
          <IconButton size="small" onClick={() => mutate()}>
            <RefreshOutlined />
          </IconButton>
        }
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "error.main",
          }}
        >
          <Typography variant="body1" color="error">
            {error instanceof Error
              ? error.message
              : t("home.components.ipInfo.errors.load")}
          </Typography>
          <Button onClick={() => mutate()} sx={{ mt: 2 }}>
            {t("shared.actions.retry")}
          </Button>
        </Box>
      </EnhancedCard>
    );
  }

  // Normal render
  return (
    <EnhancedCard
      title={t("home.components.ipInfo.title")}
      icon={<LocationOnOutlined />}
      iconColor="info"
      action={
        <IconButton size="small" onClick={() => mutate()}>
          <RefreshOutlined />
        </IconButton>
      }
    >
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* 左侧：国家和IP地址 */}
          <Box sx={{ width: "40%", overflow: "hidden" }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 1,
                overflow: "hidden",
              }}
            >
              <Box
                component="span"
                sx={{
                  fontSize: "1.5rem",
                  mr: 1,
                  display: "inline-block",
                  width: 28,
                  textAlign: "center",
                  flexShrink: 0,
                  fontFamily: '"twemoji mozilla", sans-serif',
                }}
              >
                {getCountryFlag(ipInfo?.country_code)}
              </Box>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: "medium",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}
              >
                {ipInfo?.country || t("home.components.ipInfo.labels.unknown")}
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flexShrink: 0 }}
              >
                {t("home.components.ipInfo.labels.ip")}:
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  ml: 1,
                  overflow: "hidden",
                  maxWidth: "calc(100% - 30px)",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    wordBreak: "break-all",
                  }}
                >
                  {showIp ? ipInfo?.ip : "••••••••••"}
                </Typography>
                <IconButton size="small" onClick={toggleShowIp}>
                  {showIp ? (
                    <VisibilityOffOutlined fontSize="small" />
                  ) : (
                    <VisibilityOutlined fontSize="small" />
                  )}
                </IconButton>
              </Box>
            </Box>

            <InfoItem
              label={t("home.components.ipInfo.labels.asn")}
              value={ipInfo?.asn ? `AS${ipInfo.asn}` : "N/A"}
            />
          </Box>

          {/* 右侧：组织、ISP和位置信息 */}
          <Box sx={{ width: "60%", overflow: "auto" }}>
            <InfoItem
              label={t("home.components.ipInfo.labels.isp")}
              value={ipInfo?.organization}
            />
            <InfoItem
              label={t("home.components.ipInfo.labels.org")}
              value={ipInfo?.asn_organization}
            />
            <InfoItem
              label={t("home.components.ipInfo.labels.location")}
              value={[ipInfo?.city, ipInfo?.region].filter(Boolean).join(", ")}
            />
            <InfoItem
              label={t("home.components.ipInfo.labels.timezone")}
              value={ipInfo?.timezone}
            />
          </Box>
        </Box>

        <Box
          sx={{
            mt: "auto",
            pt: 0.5,
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            opacity: 0.7,
            fontSize: "0.7rem",
          }}
        >
          <Typography variant="caption">
            {t("home.components.ipInfo.labels.autoRefresh")}: {countdown}s
          </Typography>
          <Typography
            variant="caption"
            sx={{
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {`${ipInfo?.country_code}, ${ipInfo?.longitude?.toFixed(2)}, ${ipInfo?.latitude?.toFixed(2)}`}
          </Typography>
        </Box>
      </Box>
    </EnhancedCard>
  );
};
