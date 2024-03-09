import LogsPage from "./logs";
import ProxiesPage from "./proxies";
import TestPage from "./test";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";
import RulesPage from "./rules";

import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import LogsSvg from "@/assets/image/itemicon/logs.svg?react";
import TestSvg from "@/assets/image/itemicon/test.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";

export const routers = [
  {
    label: "Label-Proxies",
    link: "/",
    icon: ProxiesSvg,
    ele: ProxiesPage,
  },
  {
    label: "Label-Profiles",
    link: "/profile",
    icon: ProfilesSvg,
    ele: ProfilesPage,
  },
  {
    label: "Label-Connections",
    link: "/connections",
    icon: ConnectionsSvg,
    ele: ConnectionsPage,
  },
  {
    label: "Label-Rules",
    link: "/rules",
    icon: RulesSvg,
    ele: RulesPage,
  },
  {
    label: "Label-Logs",
    link: "/logs",
    icon: LogsSvg,
    ele: LogsPage,
  },
  {
    label: "Label-Test",
    link: "/test",
    icon: TestSvg,
    ele: TestPage,
  },
  {
    label: "Label-Settings",
    link: "/settings",
    icon: SettingsSvg,
    ele: SettingsPage,
  },
];
