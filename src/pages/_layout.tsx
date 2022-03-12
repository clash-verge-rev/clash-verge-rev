import i18next from "i18next";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Route, Routes } from "react-router-dom";
import { alpha, createTheme, List, Paper, ThemeProvider } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import { routers } from "./_routers";
import { getAxios } from "../services/api";
import { getVergeConfig } from "../services/cmds";
import LogoSvg from "../assets/image/logo.svg";
import LayoutItem from "../components/layout/layout-item";
import LayoutControl from "../components/layout/layout-control";
import LayoutTraffic from "../components/layout/layout-traffic";
import UpdateButton from "../components/layout/update-button";

const isMacos = navigator.userAgent.includes("Mac OS X");

const Layout = () => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data } = useSWR("getVergeConfig", getVergeConfig);

  const blur = !!data?.theme_blur;
  const mode = data?.theme_mode ?? "light";

  useEffect(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") appWindow.hide();
    });

    listen("verge://refresh-clash-config", async () => {
      // the clash info may be updated
      await getAxios(true);
      mutate("getProxies");
      mutate("getClashConfig");
    });
  }, []);

  useEffect(() => {
    if (data?.language) {
      i18next.changeLanguage(data.language);
    }
  }, [data?.language]);

  const theme = useMemo(() => {
    // const background = mode === "light" ? "#f5f5f5" : "#000";
    const selectColor = mode === "light" ? "#f5f5f5" : "#d5d5d5";

    const rootEle = document.documentElement;
    rootEle.style.background = "transparent";
    rootEle.style.setProperty("--selection-color", selectColor);

    return createTheme({
      breakpoints: {
        values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
      },
      palette: {
        mode,
        primary: { main: "#5b5c9d" },
        text: { primary: "#637381", secondary: "#909399" },
      },
    });
  }, [mode]);

  const onDragging = (e: any) => {
    if (e?.target?.dataset?.windrag) {
      appWindow.startDragging();
    }
  };

  return (
    <SWRConfig value={{}}>
      <ThemeProvider theme={theme}>
        <Paper
          square
          elevation={0}
          className={`${isMacos ? "macos " : ""}layout`}
          onPointerDown={onDragging}
          sx={[
            (theme) => ({
              bgcolor: alpha(theme.palette.background.paper, blur ? 0.85 : 1),
            }),
          ]}
        >
          <div className="layout__left" data-windrag>
            <div className="the-logo" data-windrag>
              <img src={LogoSvg} alt="" data-windrag />

              <UpdateButton className="the-newbtn" />
            </div>

            <List className="the-menu" data-windrag>
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
            {!isMacos && (
              <div className="the-bar">
                <LayoutControl />
              </div>
            )}

            <div className="the-content">
              <Routes>
                {routers.map(({ label, link, ele: Ele }) => (
                  <Route key={label} path={link} element={<Ele />} />
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
