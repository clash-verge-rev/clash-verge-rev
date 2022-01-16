import useSWR, { SWRConfig } from "swr";
import { useEffect, useMemo } from "react";
import { Route, Routes } from "react-router-dom";
import { useRecoilState } from "recoil";
import { alpha, createTheme, List, Paper, ThemeProvider } from "@mui/material";
import { appWindow } from "@tauri-apps/api/window";
import { atomPaletteMode, atomThemeBlur } from "../states/setting";
import { getVergeConfig } from "../services/cmds";
import { routers } from "./_routers";
import LogoSvg from "../assets/image/logo.svg";
import Traffic from "../components/traffic";
import LayoutItem from "../components/layout-item";
import UpdateButton from "../components/update-button";
import LayoutControl from "../components/layout-control";

const Layout = () => {
  const [mode, setMode] = useRecoilState(atomPaletteMode);
  const [blur, setBlur] = useRecoilState(atomThemeBlur);
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  useEffect(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") appWindow.hide();
    });
  }, []);

  useEffect(() => {
    if (!vergeConfig) return;
    setBlur(!!vergeConfig.theme_blur);
    setMode(vergeConfig.theme_mode ?? "light");
  }, [vergeConfig]);

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
          className="layout"
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
                  {router.label}
                </LayoutItem>
              ))}
            </List>

            <div className="the-traffic" data-windrag>
              <Traffic />
            </div>
          </div>

          <div className="layout__right" data-windrag>
            <div className="the-bar">
              <LayoutControl />
            </div>

            <div className="the-content" data-windrag>
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
