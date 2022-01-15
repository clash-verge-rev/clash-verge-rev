import LogsPage from "./logs";
import ProxiesPage from "./proxies";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";

export const routers = [
  {
    label: "Proxies",
    link: "/",
    ele: ProxiesPage,
  },
  {
    label: "Profiles",
    link: "/profile",
    ele: ProfilesPage,
  },
  {
    label: "Connections",
    link: "/connections",
    ele: ConnectionsPage,
  },
  {
    label: "Logs",
    link: "/logs",
    ele: LogsPage,
  },
  {
    label: "Settings",
    link: "/settings",
    ele: SettingsPage,
  },
];
