import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import ForkRightRoundedIcon from "@mui/icons-material/ForkRightRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import LockOpenRoundedIcon from "@mui/icons-material/LockOpenRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import { createBrowserRouter, Navigate } from "react-router";

import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import HomeSvg from "@/assets/image/itemicon/home.svg?react";
import LogsSvg from "@/assets/image/itemicon/logs.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";
import UnlockSvg from "@/assets/image/itemicon/unlock.svg?react";

import Layout from "./_layout";
import ConnectionsPage from "./connections";
import HomePage from "./home";
import LogsPage from "./logs";
import ProfilesPage from "./profiles";
import ProxiesPage from "./proxies";
import RulesPage from "./rules";
import SettingsPage from "./settings";
import UnlockPage from "./unlock";

export const navItems = [
  {
    label: "Label-Home",
    path: "/home",
    icon: [<HomeRoundedIcon key="mui" />, <HomeSvg key="svg" />],
  },
  {
    label: "Label-Proxies",
    path: "/proxies",
    icon: [<WifiRoundedIcon key="mui" />, <ProxiesSvg key="svg" />],
  },
  {
    label: "Label-Profiles",
    path: "/profile",
    icon: [<DnsRoundedIcon key="mui" />, <ProfilesSvg key="svg" />],
  },
  {
    label: "Label-Connections",
    path: "/connections",
    icon: [<LanguageRoundedIcon key="mui" />, <ConnectionsSvg key="svg" />],
  },
  {
    label: "Label-Rules",
    path: "/rules",
    icon: [<ForkRightRoundedIcon key="mui" />, <RulesSvg key="svg" />],
  },
  {
    label: "Label-Logs",
    path: "/logs",
    icon: [<SubjectRoundedIcon key="mui" />, <LogsSvg key="svg" />],
  },
  {
    label: "Label-Unlock",
    path: "/unlock",
    icon: [<LockOpenRoundedIcon key="mui" />, <UnlockSvg key="svg" />],
  },
  {
    label: "Label-Settings",
    path: "/settings",
    icon: [<SettingsRoundedIcon key="mui" />, <SettingsSvg key="svg" />],
  },
];

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, element: <Navigate to="/home" /> },
      { path: "home", Component: HomePage },
      { path: "proxies", Component: ProxiesPage },
      { path: "profile", Component: ProfilesPage },
      { path: "connections", Component: ConnectionsPage },
      { path: "rules", Component: RulesPage },
      { path: "logs", Component: LogsPage },
      { path: "unlock", Component: UnlockPage },
      { path: "settings", Component: SettingsPage },
    ],
  },
]);
