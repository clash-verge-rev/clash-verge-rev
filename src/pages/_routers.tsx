import LogPage from "./log";
import ProxyPage from "./proxy";
import ProfilePage from "./profile";
import SettingPage from "./setting";
import ConnectionsPage from "./connections";

export const routers = [
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
