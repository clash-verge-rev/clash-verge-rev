import LogsPage from "./logs";
import ProxiesPage from "./proxies";
import TestPage from "./test";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";
import RulesPage from "./rules";

export const routers = [
  {
    label: "Label-Proxies",
    link: "/",
    img: "../../assets/image/itemicon/proxies.svg",
    ele: ProxiesPage,
  },
  {
    label: "Label-Profiles",
    link: "/profile",
    img: "../../assets/image/itemicon/profiles.svg",
    ele: ProfilesPage,
  },
  {
    label: "Label-Connections",
    link: "/connections",
    img: "../../assets/image/itemicon/connections.svg",
    ele: ConnectionsPage,
  },
  {
    label: "Label-Rules",
    link: "/rules",
    img: "../../assets/image/itemicon/rules.svg",
    ele: RulesPage,
  },
  {
    label: "Label-Logs",
    link: "/logs",
    img: "../../assets/image/itemicon/logs.svg",
    ele: LogsPage,
  },
  {
    label: "Label-Test",
    link: "/test",
    img: "../../assets/image/itemicon/test.svg",
    ele: TestPage,
  },
  {
    label: "Label-Settings",
    link: "/settings",
    img: "../../assets/image/itemicon/settings.svg",
    ele: SettingsPage,
  },
];
