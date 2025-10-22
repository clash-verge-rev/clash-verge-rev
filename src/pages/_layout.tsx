import { List, Paper, SvgIcon, ThemeProvider } from "@mui/material";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router";
import { SWRConfig } from "swr";

import iconDark from "@/assets/image/icon_dark.svg?react";
import iconLight from "@/assets/image/icon_light.svg?react";
import LogoSvg from "@/assets/image/logo.svg?react";
import { BaseErrorBoundary } from "@/components/base";
import { NoticeManager } from "@/components/base/NoticeManager";
import { WindowControls } from "@/components/controller/window-controller";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useConnectionData } from "@/hooks/use-connection-data";
import { useI18n } from "@/hooks/use-i18n";
import { useLogData } from "@/hooks/use-log-data";
import { useMemoryData } from "@/hooks/use-memory-data";
import { useTrafficData } from "@/hooks/use-traffic-data";
import { useVerge } from "@/hooks/use-verge";
import { useWindowDecorations } from "@/hooks/use-window";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";

import { handleNoticeMessage } from "./_layout/notificationHandlers";
import { useAppInitialization } from "./_layout/useAppInitialization";
import { useLayoutEvents } from "./_layout/useLayoutEvents";
import { useLoadingOverlay } from "./_layout/useLoadingOverlay";
import { navItems } from "./_routers";

import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";

export const portableFlag = false;

dayjs.extend(relativeTime);

const OS = getSystem();

const Layout = () => {
  const trafficData = useTrafficData();
  const memoryData = useMemoryData();
  const connectionData = useConnectionData();
  const logData = useLogData();

  const mode = useThemeMode();
  const isDark = mode !== "light";
  const { t } = useTranslation();
  const { theme } = useCustomTheme();
  const { verge } = useVerge();
  const { language } = verge ?? {};
  const { switchLanguage } = useI18n();
  const navigate = useNavigate();
  const themeReady = useMemo(() => Boolean(theme), [theme]);

  const windowControls = useRef<any>(null);
  const { decorated } = useWindowDecorations();

  const customTitlebar = useMemo(
    () =>
      !decorated ? (
        <div className="the_titlebar" data-tauri-drag-region="true">
          <WindowControls ref={windowControls} />
        </div>
      ) : null,
    [decorated],
  );

  useLoadingOverlay(themeReady);
  useAppInitialization();

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload;
      try {
        handleNoticeMessage(status, msg, t, navigate);
      } catch (error) {
        console.error("[通知处理] 失败:", error);
      }
    },
    [t, navigate],
  );

  useLayoutEvents(handleNotice);

  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      switchLanguage(language);
    }
  }, [language, switchLanguage]);

  if (!themeReady) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: mode === "light" ? "#fff" : "#181a1b",
          transition: "background 0.2s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: mode === "light" ? "#333" : "#fff",
        }}
      ></div>
    );
  }

  return (
    <SWRConfig
      value={{
        errorRetryCount: 3,
        errorRetryInterval: 5000,
        onError: (error, key) => {
          console.error(`[SWR Error] Key: ${key}, Error:`, error);
          if (key !== "getAutotemProxy") {
            console.error(`SWR Error for ${key}:`, error);
          }
        },
        dedupingInterval: 2000,
      }}
    >
      <ThemeProvider theme={theme}>
        {/* 左侧底部窗口控制按钮 */}
        <NoticeManager />
        <div
          style={{
            animation: "fadeIn 0.5s",
            WebkitAnimation: "fadeIn 0.5s",
          }}
        />
        <style>
          {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}
        </style>
        <Paper
          square
          elevation={0}
          className={`${OS} layout`}
          style={{
            borderTopLeftRadius: "0px",
            borderTopRightRadius: "0px",
          }}
          onContextMenu={(e) => {
            if (
              OS === "windows" &&
              !["input", "textarea"].includes(
                e.currentTarget.tagName.toLowerCase(),
              ) &&
              !e.currentTarget.isContentEditable
            ) {
              e.preventDefault();
            }
          }}
          sx={[
            ({ palette }) => ({ bgcolor: palette.background.paper }),
            OS === "linux"
              ? {
                  borderRadius: "8px",
                  width: "100vw",
                  height: "100vh",
                }
              : {},
          ]}
        >
          {/* Custom titlebar - rendered only when decorated is false, memoized for performance */}
          {customTitlebar}

          <div className="layout-content">
            <div className="layout-content__left">
              <div className="the-logo" data-tauri-drag-region="false">
                <div
                  data-tauri-drag-region="true"
                  style={{
                    height: "27px",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <SvgIcon
                    component={isDark ? iconDark : iconLight}
                    style={{
                      height: "36px",
                      width: "36px",
                      marginTop: "-3px",
                      marginRight: "5px",
                      marginLeft: "-3px",
                    }}
                    inheritViewBox
                  />
                  <LogoSvg fill={isDark ? "white" : "black"} />
                </div>
                <UpdateButton className="the-newbtn" />
              </div>

              <List className="the-menu">
                {navItems.map((router) => (
                  <LayoutItem
                    key={router.label}
                    to={router.path}
                    icon={router.icon}
                  >
                    {t(router.label)}
                  </LayoutItem>
                ))}
              </List>

              <div className="the-traffic">
                <LayoutTraffic />
              </div>
            </div>

            <div className="layout-content__right">
              <div className="the-bar"></div>
              <div className="the-content">
                <BaseErrorBoundary>
                  <Outlet />
                </BaseErrorBoundary>
              </div>
            </div>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
