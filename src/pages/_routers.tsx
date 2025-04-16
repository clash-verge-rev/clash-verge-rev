import LogsPage from "./logs";
import ProxiesPage from "./proxies";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";
import RulesPage from "./rules";
import HomePage from "./home";
import UnlockPage from "./unlock";
import { BaseErrorBoundary } from "@/components/base";

import HomeSvg from "@/assets/image/itemicon/home.svg?react";
import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import LogsSvg from "@/assets/image/itemicon/logs.svg?react";
import UnlockSvg from "@/assets/image/itemicon/unlock.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";

import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import ForkRightRoundedIcon from "@mui/icons-material/ForkRightRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import LockOpenRoundedIcon from "@mui/icons-material/LockOpenRounded";

export const routers = [
  {
    label: "Label-Dashboard",
    path: "/dashboard",
    icon: [<DashboardRoundedIcon />, <HomeSvg />],
    element: <HomePage />,
  },
  {
    label: "Label-Profiles",
    path: "/profile",
    icon: [<DnsRoundedIcon />, <ProfilesSvg />],
    element: <ProfilesPage />,
  },  
  {
    label: "Label-Proxies",
    path: "/",
    icon: [<WifiRoundedIcon />, <ProxiesSvg />],
    element: <ProxiesPage />,
  },
  {
    label: "Label-Rules",
    path: "/rules",
    icon: [<ForkRightRoundedIcon />, <RulesSvg />],
    element: <RulesPage />,
  },
  {
    label: "Label-Unlock",
    path: "/unlock",
    icon: [<LockOpenRoundedIcon />, <UnlockSvg />],
    element: <UnlockPage />,
  },    
  {
    label: "Label-Connections",
    path: "/connections",
    icon: [<LanguageRoundedIcon />, <ConnectionsSvg />],
    element: <ConnectionsPage />,
  },
  {
    label: "Label-Logs",
    path: "/logs",
    icon: [<SubjectRoundedIcon />, <LogsSvg />],
    element: <LogsPage />,
  },  
  {
    label: "Label-Settings",
    path: "/settings",
    icon: [<SettingsRoundedIcon />, <SettingsSvg />],
    element: <SettingsPage />,
  },
].map((router) => ({
  ...router,
  element: (
    <BaseErrorBoundary key={router.label}>{router.element}</BaseErrorBoundary>
  ),
}));
