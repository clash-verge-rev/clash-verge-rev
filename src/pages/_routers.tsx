import LogsPage from "./logs";
import ProxiesPage from "./proxies";
import TestPage from "./test";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";
import RulesPage from "./rules";
import ProxiesSVG from "@/assets/image/itemicon/proxies.svg";
import ProfilesSVG from "@/assets/image/itemicon/profiles.svg";
import ConnectionsSVG from "@/assets/image/itemicon/connections.svg";
import RulesSVG from "@/assets/image/itemicon/rules.svg";
import LogsSVG from "@/assets/image/itemicon/logs.svg";
import TestSVG from "@/assets/image/itemicon/test.svg";
import SettingsSVG from "@/assets/image/itemicon/settings.svg";

export const routers = [
  {
    label: "Label-Proxies",
    link: "/",
    img: ProxiesSVG,
    ele: ProxiesPage,
  },
  {
    label: "Label-Profiles",
    link: "/profile",
    img: ProfilesSVG,
    ele: ProfilesPage,
  },
  {
    label: "Label-Connections",
    link: "/connections",
    img: ConnectionsSVG,
    ele: ConnectionsPage,
  },
  {
    label: "Label-Rules",
    link: "/rules",
    img: RulesSVG,
    ele: RulesPage,
  },
  {
    label: "Label-Logs",
    link: "/logs",
    img: LogsSVG,
    ele: LogsPage,
  },
  {
    label: "Label-Test",
    link: "/test",
    img: TestSVG,
    ele: TestPage,
  },
  {
    label: "Label-Settings",
    link: "/settings",
    img: SettingsSVG,
    ele: SettingsPage,
  },
];
