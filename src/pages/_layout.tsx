import AppNameSvg from "@/assets/image/clash_verge.svg?react";
import LogoSvg from "@/assets/image/logo.svg?react";
import { Notice } from "@/components/base";
import { LayoutControl } from "@/components/layout/layout-control";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useVerge } from "@/hooks/use-verge";
import { useVisibility } from "@/hooks/use-visibility";
import LoadingPage from "@/pages/loading";
import { getAxios } from "@/services/api";
import { getPortableFlag } from "@/services/cmds";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";
import { DarkMode, LightMode } from "@mui/icons-material";
import { List, Paper, ThemeProvider } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { motion } from "framer-motion";
import i18next from "i18next";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router-dom";
import { SWRConfig, mutate } from "swr";
import { routers } from "./_routers";

export let portableFlag = false;
dayjs.extend(relativeTime);
const OS = getSystem();
let keepUIActive = false;

const show = {
  x: [-25, 0],
  opacity: 1,
  display: "block",
  transition: { duration: 0.6 },
};

const hide = {
  x: 20,
  opacity: 0,
  transition: { duration: 0.3 },
  transitionEnd: {
    display: "none",
  },
};

const Layout = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const { t } = useTranslation();
  const { theme, toggleTheme } = useCustomTheme();
  const visible = useVisibility();
  const mode = useThemeMode();

  const { verge } = useVerge();
  const { language, start_page, enable_system_title, enable_keep_ui_active } =
    verge || {};
  const isDark = mode === "dark";
  keepUIActive = enable_keep_ui_active ?? false;
  const navigate = useNavigate();

  appWindow.isMaximized().then((maximized) => {
    setIsMaximized(maximized);
  });
  const unlistenResize = appWindow.onResized(() => {
    appWindow.isMaximized().then((value) => {
      if (isMaximized !== value) {
        setIsMaximized(value);
      }
    });
  });

  const handleClose = (keepUIActive: boolean) => {
    if (keepUIActive) {
      appWindow.hide();
    } else {
      appWindow.close();
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && OS !== "macos") {
        handleClose(keepUIActive);
      }
    });

    const unlistenReloadAll = listen("verge://reload-all", async () => {
      mutate("getVergeConfig");
      mutate("getProxies");
      mutate("getVersion");
      mutate("getClashConfig");
      mutate("getClashInfo");
      mutate("getRuntimeConfig");
      mutate("getProxyProviders");
    });

    const unlistenRefreshClash = listen(
      "verge://refresh-clash-config",
      async () => {
        // the clash info may be updated
        await getAxios(true);
        mutate("getProxies");
        mutate("getVersion");
        mutate("getClashConfig");
        mutate("getClashInfo");
        mutate("getRuntimeConfig");
        mutate("getProxyProviders");
      },
    );

    // update the verge config
    const unlistenRefreshVerge = listen("verge://refresh-verge-config", () => {
      mutate("getVergeConfig");
    });

    // 设置提示监听
    const unlistenNotice = listen("verge://notice-message", ({ payload }) => {
      const [status, msg] = payload as [string, string];
      switch (status) {
        case "set_config::ok":
          Notice.success(t("Clash Config Updated"));
          break;
        case "set_config::error":
          Notice.error(t(msg));
          break;
        default:
          break;
      }
    });

    setTimeout(async () => {
      portableFlag = await getPortableFlag();
      await appWindow.unminimize();
      await appWindow.show();
      await appWindow.setFocus();
    }, 50);

    return () => {
      unlistenReloadAll.then((fn) => fn());
      unlistenRefreshClash.then((fn) => fn());
      unlistenRefreshVerge.then((fn) => fn());
      unlistenNotice.then((fn) => fn());
      unlistenResize.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      i18next.changeLanguage(language);
    }
    if (start_page) {
      navigate(start_page);
    }
  }, [language, start_page, visible]);

  return (
    <SWRConfig value={{ errorRetryCount: 3 }}>
      <ThemeProvider theme={theme}>
        <Paper
          square
          elevation={0}
          className={`${OS} layout`}
          onContextMenu={(e) => {
            // only prevent it on Windows
            const validList = ["input", "textarea"];
            const target = e.currentTarget;
            if (
              OS === "windows" &&
              !(
                validList.includes(target.tagName.toLowerCase()) ||
                target.isContentEditable
              )
            ) {
              e.preventDefault();
            }
          }}
          sx={[
            ({ palette }) => ({
              bgcolor: palette.background.paper,
              ...(OS === "linux" &&
                !enable_system_title && {
                  borderRadius: `${isMaximized ? 0 : "6px"}`,
                  border: "2px solid var(--divider-color)",
                  width: "calc(100vw - 4px)",
                  height: "calc(100vh - 4px)",
                }),
            }),
          ]}>
          <div
            className={`layout__left ${enable_system_title && "system-title"}`}>
            <div className="logo-wrap" data-tauri-drag-region="true">
              <div className="the-logo">
                <LogoSvg style={{ width: "50px", marginRight: "5px" }} />
                <AppNameSvg />
              </div>
              <UpdateButton className="the-newbtn" />
              <motion.div>
                <motion.button
                  animate={isDark ? show : hide}
                  className="switch-theme-btn"
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => toggleTheme(e, "light")}>
                  <DarkMode fontSize="inherit" />
                </motion.button>
                <motion.button
                  animate={isDark ? hide : show}
                  className="switch-theme-btn"
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => toggleTheme(e, "dark")}>
                  <LightMode fontSize="inherit" />
                </motion.button>
              </motion.div>
            </div>

            <List className="the-menu">
              {routers.map((router) => (
                <LayoutItem
                  key={router.label}
                  to={router.path}
                  icon={router.icon}>
                  {t(router.label)}
                </LayoutItem>
              ))}
            </List>

            <div className="the-traffic">
              <LayoutTraffic />
            </div>
          </div>

          <div
            className={`layout__right ${enable_system_title && "system-title"}`}>
            {!enable_system_title && (
              <div className="the-bar">
                <div
                  className="the-dragbar"
                  data-tauri-drag-region="true"
                  style={{ width: "100%" }}></div>
                {OS !== "macos" && (
                  <LayoutControl
                    maximized={isMaximized}
                    onClose={() => handleClose(keepUIActive)}
                  />
                )}
              </div>
            )}

            <div className="the-content">
              <Suspense fallback={<LoadingPage />}>
                <Outlet />
              </Suspense>
            </div>
            {/* when proxies page expanded item too musch, this transition will slowly */}
            {/* <TransitionGroup className="the-content">
              <CSSTransition
                key={location.pathname}
                timeout={300}
                classNames="page">
                <Suspense fallback={<LoadingPage />}>
                  <Outlet />
                </Suspense>
              </CSSTransition>
            </TransitionGroup> */}
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
