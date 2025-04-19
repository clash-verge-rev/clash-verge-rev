import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { getUserInfo, isAuthenticated, login, logout } from "@/services/auth";
import { Notice } from "@/components/base";
import { useTranslation } from "react-i18next";
import { importProfile, updateProfile, getProfiles, patchProfilesConfig } from "@/services/cmds";
import { useNavigate } from "react-router-dom";
import { appInitialized } from "@/main";
import { closeAllConnections } from "@/services/api";
import { mutate } from "swr";

// 创建一个自定义事件，用于触发数据刷新
export const REFRESH_DATA_EVENT = 'refresh-app-data';

// 默认配置文件URL
const DEFAULT_PROFILE_URL = "http://13.230.16.216/api/short_url/fHWypA";

interface AuthContextType {
  user: any | null;
  loading: boolean;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUserInfo: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(
    localStorage.getItem("isLoggedIn") === "true"
  );
  const navigate = useNavigate();
  const profileLoadAttempted = useRef(false);
  
  // 激活配置文件的函数
  const activateProfile = async (profile: string, notifySuccess: boolean) => {
    try {
      console.log("激活配置文件中...", profile);
      
      await updateProfile(profile);
      
      console.log("触发刷新事件:", REFRESH_DATA_EVENT);
      window.dispatchEvent(new Event(REFRESH_DATA_EVENT));
      
      if (notifySuccess) {
        Notice.success(t("Profile Switched"), 1000);
      }
      mutate("getProfiles");
      console.log("配置文件激活成功");
    } catch (err: any) {
      console.error("激活配置文件失败:", err);
      Notice.error(err?.message || err.toString(), 4000);
    }
  };
  
  
  // 加载默认配置文件
  const loadDefaultProfile = async () => {
    try {
      if (profileLoadAttempted.current) return;
      profileLoadAttempted.current = true;
      
      console.log("加载默认配置文件...");
      await importProfile(DEFAULT_PROFILE_URL);
      Notice.success(t("Default profile loaded successfully"));
      console.log("默认配置文件导入成功");
      
      // After import, get the profile UID and activate it
      const profilesData = await getProfiles();
      if (profilesData && profilesData.items && profilesData.items.length > 0) {
        // Find the most recently added profile (likely the one we just imported)
        // Sort by updated timestamp (descending) and take the first one
        const sortedProfiles = [...profilesData.items].sort((a, b) => 
          (b.updated || 0) - (a.updated || 0)
        );
        
        if (sortedProfiles.length > 0 && sortedProfiles[0].uid) {
          console.log("激活默认配置文件...");
          await activateProfile(sortedProfiles[0].uid, true);
          Notice.success(t("Default profile activated"));
        }
      }
    } catch (error: any) {
      console.error("加载或激活默认配置文件失败:", error);
      Notice.error(t("导入默认配置文件时出错"));
    }
  };
  
  const handleLogin = async (email: string, password: string) => {
    try {
      setLoading(true);
      
      // 添加模拟登录功能（开发环境使用）
      if (import.meta.env.DEV) {
        // 将登录状态更新放在前面，避免路由重定向闪烁
        localStorage.setItem('auth_token', 'dev_test_token');
        localStorage.setItem('isLoggedIn', 'true');
        setIsLoggedIn(true);
        
        // 先导航到主页，避免登录页闪烁
        navigate('/', { replace: true });
        
        // 然后设置用户信息
        setUser({
          id: '1',
          email: email,
          name: '测试用户',
          role: 'admin'
        });
        
        // 最后加载默认配置文件和显示通知
        await loadDefaultProfile();
        Notice.success(t("Login successful (Development Mode)"));
      } else {
        // 正常登录流程 - 生产环境使用
        await login(email, password);
        
        // 立即设置登录状态和导航，避免闪烁
        localStorage.setItem('isLoggedIn', 'true');
        setIsLoggedIn(true);
        
        // 先导航到主页，避免登录页闪烁
        navigate('/', { replace: true });
        
        // 然后获取用户信息和加载配置文件
        await refreshUserInfo();
        await loadDefaultProfile();
        Notice.success(t("Login successful"));
      }
    } catch (error: any) {
      Notice.error(error.message || t("Login failed"));
      throw error;
    } finally {
      setLoading(false);
    }
  };
  
  const handleLogout = () => {
    logout();
    setUser(null);
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userName");
    setIsLoggedIn(false);
    navigate("/login", { replace: true });
    profileLoadAttempted.current = false; // 重置配置文件加载状态，以便下次登录时重新加载
    Notice.info(t("Logged out successfully"));
  };
  
  const refreshUserInfo = async () => {
    if (!isAuthenticated()) {
      setUser(null);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      
      // 开发环境使用的模拟用户信息
      if (import.meta.env.DEV && localStorage.getItem('auth_token') === 'dev_test_token') {
        setUser({
          id: '1',
          email: 'dev@example.com',
          name: '测试用户',
          role: 'admin'
        });
        setLoading(false);
        return;
      }
      
      // 正常获取用户信息流程
      const userInfo = await getUserInfo();
      setUser(userInfo);
    } catch (error: any) {
      console.error("Failed to get user info:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };
  
  // Initial load - check if user is logged in
  useEffect(() => {
    const init = async () => {
      await refreshUserInfo();
      
      // 如果用户已登录，则加载默认配置文件
      if (isLoggedIn && appInitialized && !profileLoadAttempted.current) {
        await loadDefaultProfile();
      }
    };
    
    init();
  }, [isLoggedIn, appInitialized]);
  
  const contextValue: AuthContextType = {
    user,
    loading,
    isLoggedIn,
    login: handleLogin,
    logout: handleLogout,
    refreshUserInfo
  };
  
  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}; 