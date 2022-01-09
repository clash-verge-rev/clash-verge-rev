import { useEffect, useMemo, useState } from "react";
import useSWR, { SWRConfig } from "swr";
import { Route, Routes } from "react-router-dom";
import { useRecoilState } from "recoil";
import {
  Button,
  createTheme,
  IconButton,
  List,
  Paper,
  ThemeProvider,
} from "@mui/material";
import { HorizontalRuleRounded, CloseRounded } from "@mui/icons-material";
import { checkUpdate } from "@tauri-apps/api/updater";
import { atomPaletteMode } from "../states/setting";
import { getVergeConfig, windowDrag, windowHide } from "../services/cmds";
import LogoSvg from "../assets/image/logo.svg";
import LogPage from "./log";
import ProfilePage from "./profile";
import ProxyPage from "./proxy";
import SettingPage from "./setting";
import ConnectionsPage from "./connections";
import LayoutItem from "../components/layout-item";
import Traffic from "../components/traffic";
import UpdateDialog from "../components/update-dialog";

const routers = [
  {
    label: "Proxy",
    link: "/",
    ele: ProxyPage,
  },
  {
    label: "Profile",
    link: "/profile",
    ele: ProfilePage,
  },
  {
    label: "Connections",
    link: "/connections",
    ele: ConnectionsPage,
  },
  {
    label: "Log",
    link: "/log",
    ele: LogPage,
  },
  {
    label: "Setting",
    link: "/setting",
    ele: SettingPage,
  },
];

const Layout = () => {
  const [mode, setMode] = useRecoilState(atomPaletteMode);
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);
  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setMode(vergeConfig?.theme_mode ?? "light");
  }, [vergeConfig?.theme_mode]);

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

  return (
    <SWRConfig value={{}}>
      <ThemeProvider theme={theme}>
        <Paper square elevation={0} className="layout">
          <div className="layout__left">
            <div className="the-logo">
              <img
                src={LogoSvg}
                width="100%"
                alt=""
                onPointerDown={(e) => {
                  windowDrag();
                  e.preventDefault();
                }}
              />

              {updateInfo?.shouldUpdate && (
                <Button
                  color="error"
                  variant="contained"
                  size="small"
                  className="the-newbtn"
                  onClick={() => setDialogOpen(true)}
                >
                  New
                </Button>
              )}
            </div>

            <List className="the-menu">
              {routers.map((router) => (
                <LayoutItem key={router.label} to={router.link}>
                  {router.label}
                </LayoutItem>
              ))}
            </List>

            <div className="the-traffic">
              <Traffic />
            </div>
          </div>

          <div className="layout__right">
            <div
              className="the-bar"
              onPointerDown={(e) =>
                e.target === e.currentTarget && windowDrag()
              }
            >
              {/* todo: onClick = windowMini */}
              <IconButton size="small" sx={{ mx: 1 }} onClick={windowHide}>
                <HorizontalRuleRounded fontSize="inherit" />
              </IconButton>

              <IconButton size="small" onClick={windowHide}>
                <CloseRounded fontSize="inherit" />
              </IconButton>
            </div>

            <div className="the-content">
              <Routes>
                {routers.map(({ label, link, ele: Ele }) => (
                  <Route key={label} path={link} element={<Ele />} />
                ))}
              </Routes>
            </div>
          </div>
        </Paper>
        <UpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
