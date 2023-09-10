import dayjs from "dayjs";
import i18next from "i18next";
import relativeTime from "dayjs/plugin/relativeTime";
import { SWRConfig, mutate } from "swr";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Route, Routes } from "react-router-dom";
import { alpha, List, Paper, ThemeProvider } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import { routers } from "./_routers";
import { getAxios } from "@/services/api";
import { useVerge } from "@/hooks/use-verge";
import { ReactComponent as LogoSvg } from "@/assets/image/logo.svg";
import { BaseErrorBoundary, Notice } from "@/components/base";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutControl } from "@/components/layout/layout-control";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import getSystem from "@/utils/get-system";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);

const OS = getSystem();

const Layout = () => {
  const { t } = useTranslation();

  const { theme } = useCustomTheme();

  const { verge } = useVerge();
  const { theme_blur, language } = verge || {};

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
      mutate("getProviders");
    });

    // update the verge config
    listen("verge://refresh-verge-config", () => mutate("getVergeConfig"));

    // 设置提示监听
    listen("verge://notice-message", ({ payload }) => {
      const [status, msg] = payload as [string, string];
      switch (status) {
        case "set_config::ok":
          Notice.success("Refresh clash config");
          break;
        case "set_config::error":
          Notice.error(msg);
          break;
        default:
          break;
      }
    });
  }, []);

  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      i18next.changeLanguage(language);
    }
  }, [language]);

  return (
    <SWRConfig value={{ errorRetryCount: 3 }}>
      <ThemeProvider theme={theme}>
        <Paper
          square
          elevation={0}
          className={`${OS} layout`}
          onPointerDown={(e: any) => {
            if (e.target?.dataset?.windrag) appWindow.startDragging();
          }}
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
              bgcolor: alpha(palette.background.paper, theme_blur ? 0.8 : 1),
            }),
          ]}
        >
          <div className="layout__left" data-windrag>
            <div className="the-logo" data-windrag>
              <LogoSvg />

              {!(OS === "windows" && WIN_PORTABLE) && (
                <UpdateButton className="the-newbtn" />
              )}
            </div>

            <List className="the-menu">
              {routers.map((router) => (
                <LayoutItem key={router.label} to={router.link}>
                  {t(router.label)}
                </LayoutItem>
              ))}
            </List>

            <div className="the-traffic" data-windrag>
              <LayoutTraffic />
            </div>
          </div>

          <div className="layout__right" data-windrag>
            {OS === "windows" && (
              <div className="the-bar">
                <LayoutControl />
              </div>
            )}

            <div className="the-content">
              <Routes>
                {routers.map(({ label, link, ele: Ele }) => (
                  <Route
                    key={label}
                    path={link}
                    element={
                      <BaseErrorBoundary key={label}>
                        <Ele />
                      </BaseErrorBoundary>
                    }
                  />
                ))}
              </Routes>
            </div>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
