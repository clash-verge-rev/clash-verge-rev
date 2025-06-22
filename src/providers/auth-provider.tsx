import { Notice } from "@/components/base";
import {
    signOut as clerkSignOut,
    getClerk,
    getCurrentUser,
    initializeClerk,
    isUserSignedIn
} from "@/services/clerk";
import { getProfiles, importProfile, updateProfile } from "@/services/cmds";
import { updateProxyConfiguration } from "@/services/proxy-config";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { mutate } from "swr";

// 创建一个自定义事件，用于触发数据刷新
export const REFRESH_DATA_EVENT = 'refresh-app-data';

// 默认配置文件URL
const DEFAULT_PROFILE_URL = "http://13.230.16.216/api/short_url/fHWypA";

interface AuthContextType {
  user: any | null;
  loading: boolean;
  isLoggedIn: boolean;
  logout: () => void;
  refreshUserInfo: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profileLoadAttempted = useRef(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

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

  // 加载默认配置文件和代理节点
  const loadDefaultProfile = async () => {
    if (profileLoadAttempted.current) return;
    profileLoadAttempted.current = true;

    try {
      console.log('🚀 开始加载默认配置和代理节点...');

      // 1. 首先加载默认配置文件
      const profiles = await getProfiles();
      if (!profiles.items || profiles.items.length === 0) {
        await importProfile(DEFAULT_PROFILE_URL);
        await activateProfile("default", true);
      }

      // 2. 然后导入最新的 101Proxy 节点配置
      try {
        console.log('📡 导入 101Proxy 节点配置...');
        const result = await updateProxyConfiguration();
        
        if (result.success) {
          Notice.success(`🎉 ${result.message}`, 3000);
          console.log('✅ 代理节点配置完成');
        } else {
          Notice.error(`❌ ${result.message}`, 4000);
          console.error('❌ 代理节点配置失败:', result.message);
        }
        
        // 触发数据刷新
        window.dispatchEvent(new Event(REFRESH_DATA_EVENT));
        mutate("getProfiles");
        mutate("getProxies");
        
      } catch (proxyError: any) {
        console.error('❌ 代理节点配置失败:', proxyError);
        Notice.error(`代理节点更新失败: ${proxyError.message || proxyError}`, 4000);
      }

    } catch (err) {
      console.error("加载默认配置失败:", err);
      Notice.error("配置加载失败", 4000);
    }
  };

  const handleLogout = async () => {
    try {
      await clerkSignOut();
      setUser(null);
      setIsLoggedIn(false);
      navigate("/login");
      Notice.info(t("Logged out successfully"));
    } catch (error) {
      console.error("Logout error:", error);
      Notice.error(t("Logout failed"));
    }
  };

  const refreshUserInfo = useCallback(async () => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    setIsLoggedIn(isUserSignedIn());
  }, []);

  // Initialize Clerk and listen for auth state changes
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        console.log('Starting Clerk initialization...');
        await initializeClerk();
        
        if (!mounted) return;

        const clerk = getClerk();
        if (!clerk) {
          console.error('Failed to get Clerk instance after initialization');
          throw new Error('Failed to get Clerk instance');
        }

        console.log('Clerk initialized successfully');

        // Set initial state
        const currentUser = getCurrentUser();
        const signedIn = isUserSignedIn();
        
        console.log('Initial auth state:', { user: currentUser, signedIn });
        
        setUser(currentUser);
        setIsLoggedIn(signedIn);
        
        // Load default profile if user is signed in
        if (signedIn) {
          loadDefaultProfile();
        }

        // Listen for auth state changes
        if (clerk.addListener && typeof clerk.addListener === 'function') {
          const unsubscribe = clerk.addListener((resources: any) => {
            console.log('Clerk state changed:', resources);
            
            const updatedUser = resources.user || null;
            const updatedSignedIn = !!updatedUser;
            
            console.log('Auth state changed:', { user: updatedUser, signedIn: updatedSignedIn });
            
            setUser(updatedUser);
            setIsLoggedIn(updatedSignedIn);
            
            // Load default profile when user signs in
            if (updatedSignedIn && !profileLoadAttempted.current) {
              loadDefaultProfile();
            }
          });
          
          // Clean up listener on unmount
          return () => {
            if (unsubscribe && typeof unsubscribe === 'function') {
              unsubscribe();
            }
          };
        } else {
          console.warn('Clerk addListener method not available, will not listen for auth state changes');
        }

      } catch (error) {
        console.error('Failed to initialize auth:', error);
        // Set default state even if Clerk fails to initialize
        setUser(null);
        setIsLoggedIn(false);
      } finally {
        if (mounted) {
          console.log('Setting loading to false');
          setLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, []);

  const contextValue: AuthContextType = {
    user,
    loading,
    isLoggedIn,
    logout: handleLogout,
    refreshUserInfo
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAppAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAppAuth must be used within an AuthProvider");
  }
  return context;
}; 