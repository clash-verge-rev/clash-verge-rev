import {
  LocationOnOutlined,
  RefreshOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import { Box, Button, IconButton, Skeleton, Typography } from "@mui/material";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getIpInfo } from "@/services/api";

import { EnhancedCard } from "./enhanced-card";

// 定义刷新时间（秒）
const IP_REFRESH_SECONDS = 300;
const IP_INFO_CACHE_KEY = "cv_ip_info_cache";

// 提取InfoItem子组件并使用memo优化
const InfoItem = memo(({ label, value }: { label: string; value: string }) => (
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
const getCountryFlag = (countryCode: string) => {
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
  const [ipInfo, setIpInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showIp, setShowIp] = useState(false);
  const [countdown, setCountdown] = useState(IP_REFRESH_SECONDS);
  const lastFetchRef = useRef<number | null>(null);

  const fetchIpInfo = useCallback(
    async (force = false) => {
      setError("");

      try {
        if (!force && typeof window !== "undefined" && window.sessionStorage) {
          const raw = window.sessionStorage.getItem(IP_INFO_CACHE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            const now = Date.now();
            if (
              parsed?.ts &&
              parsed?.data &&
              now - parsed.ts < IP_REFRESH_SECONDS * 1000
            ) {
              setIpInfo(parsed.data);
              lastFetchRef.current = parsed.ts;
              const elapsed = Math.floor((now - parsed.ts) / 1000);
              setCountdown(Math.max(IP_REFRESH_SECONDS - elapsed, 0));
              setLoading(false);
              return;
            }
          }
        }
      } catch (e) {
        console.warn("Failed to read IP info from sessionStorage:", e);
      }

      try {
        setLoading(true);
        const data = await getIpInfo();
        setIpInfo(data);
        const ts = Date.now();
        lastFetchRef.current = ts;
        try {
          if (typeof window !== "undefined" && window.sessionStorage) {
            window.sessionStorage.setItem(
              IP_INFO_CACHE_KEY,
              JSON.stringify({ data, ts }),
            );
          }
        } catch (e) {
          console.warn("Failed to write IP info to sessionStorage:", e);
        }
        setCountdown(IP_REFRESH_SECONDS);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t("home.components.ipInfo.errors.load"),
        );
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // 组件加载时获取IP信息并启动基于上次请求时间的倒计时
  useEffect(() => {
    fetchIpInfo();

    let timer: number | null = null;

    const startCountdown = () => {
      timer = window.setInterval(() => {
        const now = Date.now();
        let ts = lastFetchRef.current;
        try {
          if (!ts && typeof window !== "undefined" && window.sessionStorage) {
            const raw = window.sessionStorage.getItem(IP_INFO_CACHE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              ts = parsed?.ts || null;
            }
          }
        } catch (e) {
          console.warn("Failed to read IP info from sessionStorage:", e);
          ts = ts || null;
        }

        const elapsed = ts ? Math.floor((now - ts) / 1000) : 0;
        let remaining = IP_REFRESH_SECONDS - elapsed;

        if (remaining <= 0) {
          fetchIpInfo();
          remaining = IP_REFRESH_SECONDS;
        }

        // 每5秒或倒计时结束时才更新UI
        if (remaining % 5 === 0 || remaining <= 0) {
          setCountdown(remaining);
        }
      }, 1000);
    };

    startCountdown();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fetchIpInfo]);

  const toggleShowIp = useCallback(() => {
    setShowIp((prev) => !prev);
  }, []);

  // 渲染加载状态
  if (loading) {
    return (
      <EnhancedCard
        title={t("home.components.ipInfo.title")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        action={
          <IconButton
            size="small"
            onClick={() => fetchIpInfo(true)}
            disabled={true}
          >
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

  // 渲染错误状态
  if (error) {
    return (
      <EnhancedCard
        title={t("home.components.ipInfo.title")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        action={
          <IconButton size="small" onClick={() => fetchIpInfo(true)}>
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
            {error}
          </Typography>
          <Button onClick={() => fetchIpInfo(true)} sx={{ mt: 2 }}>
            {t("shared.actions.retry")}
          </Button>
        </Box>
      </EnhancedCard>
    );
  }

  // 渲染正常数据
  return (
    <EnhancedCard
      title={t("home.components.ipInfo.title")}
      icon={<LocationOnOutlined />}
      iconColor="info"
      action={
        <IconButton size="small" onClick={() => fetchIpInfo(true)}>
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
              value={ipInfo?.isp}
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
            {ipInfo?.country_code}, {ipInfo?.longitude?.toFixed(2)},{" "}
            {ipInfo?.latitude?.toFixed(2)}
          </Typography>
        </Box>
      </Box>
    </EnhancedCard>
  );
};
