import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import LogsSvg from "@/assets/image/itemicon/logs.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";
import TestSvg from "@/assets/image/itemicon/test.svg?react";
import { BaseErrorBoundary } from "@/components/base";
import Layout from "@/pages/_layout";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import ForkRightRoundedIcon from "@mui/icons-material/ForkRightRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import WifiTetheringRoundedIcon from "@mui/icons-material/WifiTetheringRounded";
import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";

const ProxiesPage = lazy(() => import("./proxies"));
const ProfilesPage = lazy(() => import("./profiles"));
const ConnectionsPage = lazy(() => import("./connections"));
const RulesPage = lazy(() => import("./rules"));
const LogsPage = lazy(() => import("./logs"));
const TestPage = lazy(() => import("./test"));
const SettingsPage = lazy(() => import("./settings"));
const NotFountPage = lazy(() => import("./not_found"));

export const routers = [
  {
    label: "Label-Proxies",
    path: "/",
    icon: [<WifiRoundedIcon />, <ProxiesSvg />],
    element: <ProxiesPage />,
  },
  {
    label: "Label-Profiles",
    path: "/profile",
    icon: [<DnsRoundedIcon />, <ProfilesSvg />],
    element: <ProfilesPage />,
  },
  {
    label: "Label-Connections",
    path: "/connections",
    icon: [<LanguageRoundedIcon />, <ConnectionsSvg />],
    element: <ConnectionsPage />,
  },
  {
    label: "Label-Rules",
    path: "/rules",
    icon: [<ForkRightRoundedIcon />, <RulesSvg />],
    element: <RulesPage />,
  },
  {
    label: "Label-Logs",
    path: "/logs",
    icon: [<SubjectRoundedIcon />, <LogsSvg />],
    element: <LogsPage />,
  },
  {
    label: "Label-Test",
    path: "/test",
    icon: [<WifiTetheringRoundedIcon />, <TestSvg />],
    element: <TestPage />,
  },
  {
    label: "Label-Settings",
    path: "/settings",
    icon: [<SettingsRoundedIcon />, <SettingsSvg />],
    element: <SettingsPage />,
  },
];

const routerObj = [
  {
    path: "/",
    element: <Layout />,
    errorElement: <BaseErrorBoundary />,
    children: [
      {
        errorElement: <BaseErrorBoundary />,
        children: [
          { index: true, element: <ProxiesPage /> },
          ...routers.map((item) => ({
            path: item.path,
            element: item.element,
          })),
          { path: "*", element: <NotFountPage /> },
        ],
      },
    ],
  },
];

const router = createBrowserRouter(routerObj);

export default router;
