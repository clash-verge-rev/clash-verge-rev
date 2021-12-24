import { useEffect, useMemo } from "react";
import useSWR, { SWRConfig } from "swr";
import { Route, Routes } from "react-router-dom";
import { useRecoilState } from "recoil";
import { createTheme, List, Paper, ThemeProvider } from "@mui/material";
import { atomPaletteMode } from "../states/setting";
import { getVergeConfig } from "../services/command";
import LogoSvg from "../assets/image/logo.svg";
import LogPage from "./log";
import HomePage from "./home";
import ProfilePage from "./profile";
import ProxyPage from "./proxy";
import SettingPage from "./setting";
import ConnectionsPage from "./connections";
import ListItemLink from "../components/list-item-link";
import Traffic from "../components/traffic";

const routers = [
  {
    label: "代理",
    link: "/proxy",
  },
  {
    label: "配置",
    link: "/profile",
  },
  {
    label: "连接",
    link: "/connections",
  },
  {
    label: "日志",
    link: "/log",
  },
  {
    label: "设置",
    link: "/setting",
  },
];

const Layout = () => {
  const [mode, setMode] = useRecoilState(atomPaletteMode);
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  useEffect(() => {
    setMode(vergeConfig?.theme_mode ?? "light");
  }, [vergeConfig?.theme_mode]);

  const theme = useMemo(() => {
    if (mode === "light") {
      document.documentElement.style.background = "#f5f5f5";
      document.documentElement.style.setProperty(
        "--selection-color",
        "#f5f5f5"
      );
    } else {
      document.documentElement.style.background = "#000";
      document.documentElement.style.setProperty(
        "--selection-color",
        "#d5d5d5"
      );
    }

    return createTheme({
      breakpoints: {
        values: {
          xs: 0,
          sm: 650,
          md: 900,
          lg: 1200,
          xl: 1536,
        },
      },
      palette: {
        mode,
        primary: {
          main: "#5b5c9d",
        },
        text: {
          primary: "#637381",
          secondary: "#909399",
        },
      },
    });
  }, [mode]);

  return (
    <SWRConfig value={{}}>
      <ThemeProvider theme={theme}>
        <Paper square elevation={0} className="layout">
          <div className="layout__sidebar">
            <div className="layout__logo">
              <img src={LogoSvg} width="100%" alt="" />
            </div>

            <List sx={{ userSelect: "none" }}>
              {routers.map((router) => (
                <ListItemLink key={router.label} to={router.link}>
                  {router.label}
                </ListItemLink>
              ))}
            </List>

            <div className="layout__traffic">
              <Traffic />
            </div>
          </div>

          <div className="layout__content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/proxy" element={<ProxyPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/log" element={<LogPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/setting" element={<SettingPage />} />
            </Routes>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
