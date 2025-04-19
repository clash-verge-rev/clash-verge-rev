import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import { BaseLoadingOverlay } from "@/components/base";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isLoggedIn, loading } = useAuth();
  const location = useLocation();
  
  // Show loading when checking authentication status
  if (loading) {
    return <BaseLoadingOverlay />;
  }
  
  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  // Render children if authenticated
  return <>{children}</>;
}; 