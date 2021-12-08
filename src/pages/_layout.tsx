import { Route, Routes } from "react-router-dom";
import { List, Paper, Typography } from "@mui/material";
import LogPage from "../pages/log";
import HomePage from "../pages/home";
import ProxyPage from "../pages/proxy";
import SettingPage from "../pages/setting";
import ProfilesPage from "../pages/profiles";
import ConnectionsPage from "../pages/connections";
import ListItemLink from "../components/list-item-link";
import Traffic from "../components/traffic";

const Layout = () => {
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

  return (
    <Paper square elevation={0} className="layout">
      <div className="layout__sidebar">
        <Typography
          variant="h3"
          component="h1"
          sx={{ my: 2, px: 2, textAlign: "center", userSelect: "none" }}
        >
          Clash Verge
        </Typography>

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
  );
};

export default Layout;
