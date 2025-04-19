import ProxiesPage from "./proxies";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";
import RulesPage from "./rules";
import HomePage from "./home";
import UnlockPage from "./unlock";
import LoginPage from "./login";
import { BaseErrorBoundary } from "@/components/base";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Navigate } from "react-router-dom";

import HomeSvg from "@/assets/image/itemicon/home.svg?react";
import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import UnlockSvg from "@/assets/image/itemicon/unlock.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";

import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import ForkRightRoundedIcon from "@mui/icons-material/ForkRightRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import LockOpenRoundedIcon from "@mui/icons-material/LockOpenRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";

// 定义路由类型
interface RouterItem {
  label?: string;
  path: string;
  icon?: React.ReactNode[];
  element: React.ReactNode;
}

// Public routes (not requiring authentication)
export const publicRoutes: RouterItem[] = [
  {
    // 登录页面不显示标签
    path: "/login",
    element: <LoginPage />,
  },
  // 根路径直接重定向到登录页面
  {
    path: "/",
    element: <Navigate to="/home" replace />,
  }
];

// Protected routes (requiring authentication)
export const protectedRoutes: RouterItem[] = [
  {
    label: "Label-Home",
    path: "/home",
    icon: [<HomeRoundedIcon />, <HomeSvg />],
    element: <HomePage />,
  },
  {
    label: "Label-Proxies",
    path: "/proxies",
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
    label: "Label-Unlock",
    path: "/unlock",
    icon: [<LockOpenRoundedIcon />, <UnlockSvg />],
    element: <UnlockPage />,
  },
  {
    label: "Label-Settings",
    path: "/settings",
    icon: [<SettingsRoundedIcon />, <SettingsSvg />],
    element: <SettingsPage />,
  },
];

// Process protected routes to wrap them with ProtectedRoute
const processedProtectedRoutes = protectedRoutes.map((router) => ({
  ...router,
  element: (
    <BaseErrorBoundary key={router.label}>
      <ProtectedRoute>
        {router.element}
      </ProtectedRoute>
    </BaseErrorBoundary>
  ),
}));

// Process public routes 
const processedPublicRoutes = publicRoutes.map((router) => ({
  ...router,
  element: router.element ? (
    <BaseErrorBoundary key={router.path}>
      {router.element}
    </BaseErrorBoundary>
  ) : router.element,
}));

// Combine all routes for the router - 公共路由放在前面，确保它们优先匹配
export const routers = [...processedPublicRoutes, ...processedProtectedRoutes];
