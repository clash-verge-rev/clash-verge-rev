import dayjs from "dayjs";
import i18next from "i18next";
import relativeTime from "dayjs/plugin/relativeTime";
import { SWRConfig, mutate } from "swr";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoutes } from "react-router-dom";
import { List, Paper, ThemeProvider, SvgIcon } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import { routers } from "./_routers";
import { getAxios } from "@/services/api";
import { useVerge } from "@/hooks/use-verge";
import LogoSvg from "@/assets/image/logo.svg?react";
import iconLight from "@/assets/image/icon_light.svg?react";
import iconDark from "@/assets/image/icon_dark.svg?react";
import { atomThemeMode } from "@/services/states";
import { useRecoilState } from "recoil";
import { Notice } from "@/components/base";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutControl } from "@/components/layout/layout-control";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import getSystem from "@/utils/get-system";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";
import { getPortableFlag } from "@/services/cmds";
import { useNavigate } from "react-router-dom";
import React from "react";
import { TransitionGroup, CSSTransition } from "react-transition-group";
export let portableFlag = false;

dayjs.extend(relativeTime);

const OS = getSystem();

const Layout = () => {
  const [mode] = useRecoilState(atomThemeMode);
  const isDark = mode === "light" ? false : true;
  const { t } = useTranslation();
  const { theme } = useCustomTheme();

  const { verge } = useVerge();
  const { language, start_page } = verge || {};
  const navigate = useNavigate();
  const location = useLocation();
  const routersEles = useRoutes(routers);
  if (!routersEles) return null;

  useEffect(() => {
    window.addEventListener("keydown", (e) => {
      // macOS有cmd+w
      if (e.key === "Escape" && OS !== "macos") {
        appWindow.close();
      }
    });

    listen("verge://refresh-clash-config", async () => {
      // the clash info may be updated
      await getAxios(true);
      mutate("getProxies");
      mutate("getVersion");
      mutate("getClashConfig");
      mutate("getProxyProviders");
    });

    // update the verge config
    listen("verge://refresh-verge-config", () => mutate("getVergeConfig"));

    // 设置提示监听
    listen("verge://notice-message", ({ payload }) => {
      const [status, msg] = payload as [string, string];
      switch (status) {
        case "set_config::ok":
          Notice.success(t("Clash Config Updated"));
          break;
        case "set_config::error":
          Notice.error(msg);
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
  }, []);

  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      i18next.changeLanguage(language);
    }
    if (start_page) {
      navigate(start_page);
    }
  }, [language, start_page]);

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
            }),
            OS === "linux"
              ? {
                  borderRadius: "8px",
                  border: "2px solid var(--divider-color)",
                  width: "calc(100vw - 4px)",
                  height: "calc(100vh - 4px)",
                }
              : {},
          ]}
        >
          <div className="layout__left">
            <div className="the-logo" data-tauri-drag-region="true">
              <div
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
              {<UpdateButton className="the-newbtn" />}
            </div>

            <List className="the-menu">
              {routers.map((router) => (
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

          <div className="layout__right">
            {
              <div className="the-bar">
                <div
                  className="the-dragbar"
                  data-tauri-drag-region="true"
                  style={{ width: "100%" }}
                ></div>
                {OS !== "macos" && <LayoutControl />}
              </div>
            }

            <TransitionGroup className="the-content">
              <CSSTransition
                key={location.pathname}
                timeout={300}
                classNames="page"
              >
                {React.cloneElement(routersEles, { key: location.pathname })}
              </CSSTransition>
            </TransitionGroup>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
