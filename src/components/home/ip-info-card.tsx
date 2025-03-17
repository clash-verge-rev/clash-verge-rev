import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  Button,
  Skeleton,
  IconButton,
  useTheme,
} from "@mui/material";
import {
  LocationOnOutlined,
  RefreshOutlined,
  VisibilityOutlined,
  VisibilityOffOutlined,
} from "@mui/icons-material";
import { EnhancedCard } from "./enhanced-card";
import { getIpInfo } from "@/services/api";
import { useState, useEffect, useCallback, memo } from "react";

// 定义刷新时间（秒）
const IP_REFRESH_SECONDS = 300;

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

  // 获取IP信息
  const fetchIpInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await getIpInfo();
      setIpInfo(data);
      setCountdown(IP_REFRESH_SECONDS);
    } catch (err: any) {
      setError(err.message || t("Failed to get IP info"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 组件加载时获取IP信息
  useEffect(() => {
    fetchIpInfo();
    
    // 倒计时实现优化，减少不必要的重渲染
    let timer: number | null = null;
    let currentCount = IP_REFRESH_SECONDS;
    
    // 只在必要时更新状态，减少重渲染次数
    const startCountdown = () => {
      timer = window.setInterval(() => {
        currentCount -= 1;
        
        if (currentCount <= 0) {
          fetchIpInfo();
          currentCount = IP_REFRESH_SECONDS;
        }
        
        // 每5秒或倒计时结束时才更新UI
        if (currentCount % 5 === 0 || currentCount <= 0) {
          setCountdown(currentCount);
        }
      }, 1000);
    };
    
    startCountdown();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fetchIpInfo]);

  const toggleShowIp = useCallback(() => {
    setShowIp(prev => !prev);
  }, []);

  // 渲染加载状态
  if (loading) {
    return (
      <EnhancedCard
        title={t("IP Information")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        action={
          <IconButton size="small" onClick={fetchIpInfo} disabled={true}>
            <RefreshOutlined />
          </IconButton>
        }
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Skeleton variant="text" width="60%" height={32} />
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
        title={t("IP Information")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        action={
          <IconButton size="small" onClick={fetchIpInfo}>
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
          <Button onClick={fetchIpInfo} sx={{ mt: 2 }}>
            {t("Retry")}
          </Button>
        </Box>
      </EnhancedCard>
    );
  }

  // 渲染正常数据
  return (
    <EnhancedCard
      title={t("IP Information")}
      icon={<LocationOnOutlined />}
      iconColor="info"
      action={
        <IconButton size="small" onClick={fetchIpInfo}>
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
                {ipInfo?.country || t("Unknown")}
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flexShrink: 0 }}
              >
                {t("IP")}:
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
              label={t("ASN")}
              value={ipInfo?.asn ? `AS${ipInfo.asn}` : "N/A"}
            />
          </Box>

          {/* 右侧：组织、ISP和位置信息 */}
          <Box sx={{ width: "60%", overflow: "auto" }}>
            <InfoItem label={t("ISP")} value={ipInfo?.isp} />
            <InfoItem label={t("ORG")} value={ipInfo?.asn_organization} />
            <InfoItem
              label={t("Location")}
              value={[ipInfo?.city, ipInfo?.region]
                .filter(Boolean)
                .join(", ")}
            />
            <InfoItem label={t("Timezone")} value={ipInfo?.timezone} />
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
            {t("Auto refresh")}: {countdown}s
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
