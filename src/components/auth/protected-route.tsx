import { BaseLoadingOverlay } from "@/components/base";
import { useAppAuth } from "@/providers/auth-provider";
import React, { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { loading, isLoggedIn } = useAppAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  // 确保在加载完成后再进行路由判断
  useEffect(() => {
    if (!loading) {
      if (isLoggedIn && location.pathname === '/login') {
        // 如果已登录但在登录页面，重定向到首页
        console.log('用户已登录，从登录页重定向到首页');
        navigate('/home', { replace: true });
      }
    }
  }, [loading, isLoggedIn, location.pathname, navigate]);
  
  // Show loading when checking authentication status
  if (loading) {
    return <BaseLoadingOverlay isLoading={true} />;
  }
  
  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  // Render children if authenticated
  return <>{children}</>;
}; 