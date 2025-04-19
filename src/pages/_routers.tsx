import ProxiesPage from "./proxies";
import SettingsPage from "./settings";
import HomePage from "./home";
import LoginPage from "./login";
import { BaseErrorBoundary } from "@/components/base";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Navigate } from "react-router-dom";

import HomeSvg from "@/assets/image/itemicon/home.svg?react";
import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";

import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";

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
