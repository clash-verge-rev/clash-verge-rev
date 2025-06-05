import Layout from "@/pages/_layout";
import NotFountPage from "@/pages/not_found";
import { createRootRoute } from "@tanstack/react-router";

import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import LogsSvg from "@/assets/image/itemicon/logs.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";
import TestSvg from "@/assets/image/itemicon/test.svg?react";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import ForkRightRoundedIcon from "@mui/icons-material/ForkRightRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import WifiTetheringRoundedIcon from "@mui/icons-material/WifiTetheringRounded";

export const Route = createRootRoute({
  component: () => <Layout />,
  notFoundComponent: () => <NotFountPage />,
  // errorComponent: () => <BaseErrorBoundary />,
});

export const routes = [
  {
    label: "Label-Proxies",
    path: "/",
    icon: [<WifiRoundedIcon />, <ProxiesSvg />],
  },
  {
    label: "Label-Profiles",
    path: "/profiles",
    icon: [<DnsRoundedIcon />, <ProfilesSvg />],
  },
  {
    label: "Label-Connections",
    path: "/connections",
    icon: [<LanguageRoundedIcon />, <ConnectionsSvg />],
  },
  {
    label: "Label-Rules",
    path: "/rules",
    icon: [<ForkRightRoundedIcon />, <RulesSvg />],
  },
  {
    label: "Label-Logs",
    path: "/logs",
    icon: [<SubjectRoundedIcon />, <LogsSvg />],
  },
  {
    label: "Label-Test",
    path: "/test",
    icon: [<WifiTetheringRoundedIcon />, <TestSvg />],
  },
  {
    label: "Label-Settings",
    path: "/settings",
    icon: [<SettingsRoundedIcon />, <SettingsSvg />],
  },
];
