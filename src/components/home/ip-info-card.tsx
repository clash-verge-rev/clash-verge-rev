import {
  LocationOnOutlined,
  RefreshOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import { Box, Button, IconButton, Skeleton, Typography } from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "foxact/use-abortable-effect";
import { useIntersection } from "foxact/use-intersection";
import type { XOR } from "foxts/ts-xor";
import {
  memo,
  useCallback,
  useState,
  useEffectEvent,
  useMemo,
  forwardRef,
} from "react";
import { useTranslation } from "react-i18next";
import useSWRImmutable from "swr/immutable";

import { getIpInfo } from "@/services/api";
import { SWR_EXTERNAL_API } from "@/services/config";

import { EnhancedCard } from "./enhanced-card";

// 定义刷新时间（秒）
const IP_REFRESH_SECONDS = 300;
const COUNTDOWN_TICK_INTERVAL = 5_000;
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

type CountDownState = XOR<
  {
    type: "countdown";
    remainingSeconds: number;
  },
  {
    type: "revalidating";
  }
>;

const IPInfoCardContainer = forwardRef<HTMLElement, React.PropsWithChildren>(
  ({ children }, ref) => {
    const { t } = useTranslation();
    const { mutate } = useIPInfo();

    return (
      <EnhancedCard
        title={t("home.components.ipInfo.title")}
        icon={<LocationOnOutlined />}
        iconColor="info"
        ref={ref}
        action={
          <IconButton size="small" onClick={() => mutate()}>
            <RefreshOutlined />
          </IconButton>
        }
      >
        {children}
      </EnhancedCard>
    );
  },
);

// IP信息卡片组件
export const IpInfoCard = () => {
  const { t } = useTranslation();
  const [showIp, setShowIp] = useState(false);
  const appWindow = useMemo(() => getCurrentWebviewWindow(), []);

  // track ip info card has been in viewport or not
  // hasIntersected default to false, and will be true once the card is in viewport
  // and will never be false again afterwards (unless resetIntersected is called or
  // the component is unmounted)
  const [containerRef, hasIntersected, _resetIntersected] = useIntersection({
    rootMargin: "0px",
  });

  const [countdown, setCountdown] = useState<CountDownState>({
    type: "countdown",
    remainingSeconds: IP_REFRESH_SECONDS,
  });

  const { data: ipInfo, error, isLoading, mutate } = useIPInfo();

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
      if (
        // has intersected at least once
        // this avoids unncessary revalidation if user never scrolls down,
        // then we will only load initially once.
        hasIntersected &&
        // is online
        navigator.onLine &&
        // there is no ongoing revalidation already scheduled
        countdown.type !== "revalidating" &&
        // window is visible
        (await appWindow.isVisible())
      ) {
        setCountdown({ type: "revalidating" });
        // we do not care about the result of mutate here. after mutate is done,
        // simply wait for next interval tick with `setCountdown({ type: "countdown", ... })`
        try {
          await mutate();
        } finally {
          // in case mutate throws error, we still need to reset the countdown state
          setCountdown({
            type: "countdown",
            remainingSeconds: IP_REFRESH_SECONDS,
          });
        }
      } else {
        // do nothing. we even skip "setCountdown" to reduce re-renders
        //
        // but the remaining time still <= 0, and setInterval is not stopped, this
        // callback will still be regularly triggered, as soon as the window is visible
        // or network online again, we mutate() immediately in the following tick.
      }
    } else {
      setCountdown({
        type: "countdown",
        remainingSeconds: remaining,
      });
    }
  });

  // Countdown / refresh scheduler — updates UI every 1s and triggers immediate revalidation when expired
  useEffect(() => {
    let timer: number | null = null;

    // Do not add document.hidden check here as it is not reliable in Tauri.
    //
    // Thank god IntersectionObserver is a DOM API that relies on DOM/webview
    // instead of Tauri, which is reliable enough.
    if (hasIntersected) {
      console.debug(
        "IP info card has entered the viewport, starting the countdown interval.",
      );
      timer = window.setInterval(onCountdownTick, COUNTDOWN_TICK_INTERVAL);
    } else {
      console.debug(
        "IP info card has not yet entered the viewport, no counting down.",
      );
    }

    // This will fire when the window is minimized or restored
    document.addEventListener("visibilitychange", onVisibilityChange);
    // Tauri's visibility change detection is actually broken on some platforms:
    // https://github.com/tauri-apps/tauri/issues/10592
    //
    // It is working on macOS though (tested).
    // So at least we should try to pause countdown on supported platforms to
    // reduce power consumption.
    function onVisibilityChange() {
      if (document.hidden) {
        console.debug("Document hidden, pause the interval");
        // Pause the timer
        if (timer != null) {
          clearInterval(timer);
          timer = null;
        }
      } else if (hasIntersected) {
        console.debug("Document visible, resume the interval");
        // Resume the timer only when previous one is cleared
        if (timer == null) {
          timer = window.setInterval(onCountdownTick, COUNTDOWN_TICK_INTERVAL);
        }
      } else {
        console.debug(
          "Document visible, but IP info card has never entered the viewport, not even once, not starting the interval.",
        );
      }
    }

    return () => {
      if (timer != null) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasIntersected]);

  const toggleShowIp = useCallback(() => {
    setShowIp((prev) => !prev);
  }, []);

  let mainElement: React.ReactElement;

  switch (true) {
    case isLoading:
      mainElement = (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Skeleton variant="text" width="60%" height={30} />
          <Skeleton variant="text" width="80%" height={24} />
          <Skeleton variant="text" width="70%" height={24} />
          <Skeleton variant="text" width="50%" height={24} />
        </Box>
      );
      break;
    case !!error:
      mainElement = (
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
      );
      break;
    default: // Normal render
      mainElement = (
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
                  {ipInfo?.country ||
                    t("home.components.ipInfo.labels.unknown")}
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
                value={[ipInfo?.city, ipInfo?.region]
                  .filter(Boolean)
                  .join(", ")}
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
              {t("home.components.ipInfo.labels.autoRefresh")}
              {countdown.type === "countdown"
                ? `: ${countdown.remainingSeconds}s`
                : "..."}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {`${ipInfo?.country_code ?? "N/A"}, ${ipInfo?.longitude?.toFixed(2) ?? "N/A"}, ${ipInfo?.latitude?.toFixed(2) ?? "N/A"}`}
            </Typography>
          </Box>
        </Box>
      );
  }

  return (
    <IPInfoCardContainer ref={containerRef}>{mainElement}</IPInfoCardContainer>
  );
};

function useIPInfo() {
  return useSWRImmutable(IP_INFO_CACHE_KEY, getIpInfo, SWR_EXTERNAL_API);
}
