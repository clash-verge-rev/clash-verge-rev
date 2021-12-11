import { useMemo } from "react";
import { Route, Routes } from "react-router-dom";
import { useRecoilValue } from "recoil";
import { createTheme, List, Paper, ThemeProvider } from "@mui/material";
import { atomPaletteMode } from "../states/setting";
import LogoSvg from "../assets/image/logo.svg";
import LogPage from "../pages/log";
import HomePage from "../pages/home";
import ProxyPage from "../pages/proxy";
import SettingPage from "../pages/setting";
import ProfilesPage from "../pages/profiles";
import ConnectionsPage from "../pages/connections";
import ListItemLink from "../components/list-item-link";
import Traffic from "../components/traffic";

const Layout = () => {
  const paletteMode = useRecoilValue(atomPaletteMode);

  const routers = [
    {
      label: "代理",
      link: "/proxy",
    },
    {
      label: "规则",
      link: "/profiles",
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

  const theme = useMemo(() => {
    if (paletteMode === "light") {
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
      palette: {
        mode: paletteMode,
        primary: {
          main: "#5b5c9d",
        },
        text: {
          primary: "#637381",
          secondary: "#909399",
        },
      },
    });
  }, [paletteMode]);

  return (
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
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/log" element={<LogPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/setting" element={<SettingPage />} />
          </Routes>
        </div>
      </Paper>
    </ThemeProvider>
  );
};

export default Layout;
