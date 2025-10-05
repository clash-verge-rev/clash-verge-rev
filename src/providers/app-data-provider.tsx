import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useMemo } from "react";
import useSWR from "swr";
import {
  getBaseConfig,
  getRuleProviders,
  getRules,
} from "tauri-plugin-mihomo-api";

// import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
// import { useVisibility } from "@/hooks/use-visibility";
import {
  calcuProxies,
  calcuProxyProviders,
  getAppUptime,
  getRunningMode,
  getSystemProxy,
} from "@/services/cmds";

import { AppDataContext, AppDataContextType } from "./app-data-context";

// 全局数据提供者组件
export const AppDataProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // const pageVisible = useVisibility();
  // const { clashInfo } = useClashInfo();
  const { verge } = useVerge();

  // 存储上一次连接数据用于速度计算
  // const previousConnectionsRef = useRef<Map<string, ConnectionSpeedData>>(
  //   new Map(),
  // );

  // 计算连接速度的函数
  // const calculateConnectionSpeeds = (
  //   currentConnections: IConnectionsItem[],
  // ): ConnectionWithSpeed[] => {
  //   const now = Date.now();
  //   const currentMap = new Map<string, ConnectionSpeedData>();

  //   return currentConnections.map((conn) => {
  //     const connWithSpeed: ConnectionWithSpeed = {
  //       ...conn,
  //       curUpload: 0,
  //       curDownload: 0,
  //     };

  //     const currentData: ConnectionSpeedData = {
  //       id: conn.id,
  //       upload: conn.upload,
  //       download: conn.download,
  //       timestamp: now,
  //     };

  //     currentMap.set(conn.id, currentData);

  //     const previousData = previousConnectionsRef.current.get(conn.id);
  //     if (previousData) {
  //       const timeDiff = (now - previousData.timestamp) / 1000; // 转换为秒

  //       if (timeDiff > 0) {
  //         const uploadDiff = conn.upload - previousData.upload;
  //         const downloadDiff = conn.download - previousData.download;

  //         // 计算每秒速度 (字节/秒)
  //         connWithSpeed.curUpload = Math.max(0, uploadDiff / timeDiff);
  //         connWithSpeed.curDownload = Math.max(0, downloadDiff / timeDiff);
  //       }
  //     }

  //     return connWithSpeed;
  //   });
  // };

  // 基础数据 - 中频率更新 (5秒)
  const { data: proxiesData, mutate: refreshProxy } = useSWR(
    "getProxies",
    calcuProxies,
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
      suspense: false,
      errorRetryCount: 3,
    },
  );

  // 监听profile和clash配置变更事件
  useEffect(() => {
    let lastProfileId: string | null = null;
    let lastUpdateTime = 0;
    const refreshThrottle = 500;

    let isUnmounted = false;
    const scheduledTimeouts = new Set<ReturnType<typeof setTimeout>>();
    const cleanupFns: Array<() => void> = [];
    const fallbackWindowListeners: Array<[string, EventListener]> = [];

    const registerCleanup = (fn: () => void) => {
      if (isUnmounted) {
        fn();
      } else {
        cleanupFns.push(fn);
      }
    };

    const scheduleTimeout = (
      callback: () => void | Promise<void>,
      delay: number,
    ) => {
      const timeoutId = window.setTimeout(() => {
        scheduledTimeouts.delete(timeoutId);
        void callback();
      }, delay);

      scheduledTimeouts.add(timeoutId);
      return timeoutId;
    };

    const clearScheduledTimeout = (
      timeoutId: ReturnType<typeof setTimeout>,
    ) => {
      if (scheduledTimeouts.has(timeoutId)) {
        clearTimeout(timeoutId);
        scheduledTimeouts.delete(timeoutId);
      }
    };

    const clearAllTimeouts = () => {
      scheduledTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      scheduledTimeouts.clear();
    };

    const withTimeout = async <T,>(
      promise: Promise<T>,
      timeoutMs: number,
      label: string,
    ): Promise<T> => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = scheduleTimeout(() => reject(new Error(label)), timeoutMs);
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId !== null) {
          clearScheduledTimeout(timeoutId);
        }
      }
    };

    const handleProfileChanged = (event: { payload: string }) => {
      const newProfileId = event.payload;
      const now = Date.now();

      console.log(`[AppDataProvider] Profile切换事件: ${newProfileId}`);

      if (
        lastProfileId === newProfileId &&
        now - lastUpdateTime < refreshThrottle
      ) {
        console.log("[AppDataProvider] 重复事件被防抖，跳过");
        return;
      }

      lastProfileId = newProfileId;
      lastUpdateTime = now;

      // 刷新规则数据
      refreshRules().catch((error) =>
        console.warn("[AppDataProvider] 规则刷新失败:", error),
      );
      refreshRuleProviders().catch((error) =>
        console.warn("[AppDataProvider] 规则提供者刷新失败:", error),
      );

      // scheduleTimeout(() => {
      //   void forceRefreshProxies()
      //     .catch((error) => {
      //       console.warn("[AppDataProvider] forceRefreshProxies 失败:", error);
      //     })
      //     .finally(() => {
      //       scheduleTimeout(() => {
      //         refreshProxy().catch((error) => {
      //           console.warn("[AppDataProvider] 普通刷新也失败:", error);
      //         });
      //       }, 200);
      //     });
      // }, 0);
    };

    const handleRefreshClash = () => {
      const now = Date.now();
      console.log("[AppDataProvider] Clash配置刷新事件");

      if (now - lastUpdateTime <= refreshThrottle) {
        return;
      }

      lastUpdateTime = now;

      scheduleTimeout(async () => {
        try {
          console.log("[AppDataProvider] Clash刷新 - 强制刷新代理缓存");
          // await withTimeout(
          //   forceRefreshProxies(),
          //   8000,
          //   "forceRefreshProxies timeout",
          // );
          await refreshProxy();
        } catch (error) {
          console.error(
            "[AppDataProvider] Clash刷新时强制刷新代理缓存失败:",
            error,
          );
          refreshProxy().catch((e) =>
            console.warn("[AppDataProvider] Clash刷新普通刷新也失败:", e),
          );
        }
      }, 0);
    };

    const handleRefreshProxy = () => {
      const now = Date.now();
      console.log("[AppDataProvider] 代理配置刷新事件");

      if (now - lastUpdateTime <= refreshThrottle) {
        return;
      }

      lastUpdateTime = now;

      scheduleTimeout(() => {
        refreshProxy().catch((error) =>
          console.warn("[AppDataProvider] 代理刷新失败:", error),
        );
      }, 100);
    };

    // const handleForceRefreshProxies = () => {
    //   console.log("[AppDataProvider] 强制代理刷新事件");

    //   void forceRefreshProxies()
    //     .then(() => {
    //       console.log("[AppDataProvider] 强制刷新代理缓存完成");
    //       return refreshProxy();
    //     })
    //     .then(() => {
    //       console.log("[AppDataProvider] 前端代理数据刷新完成");
    //     })
    //     .catch((error) => {
    //       console.warn("[AppDataProvider] 强制代理刷新失败:", error);
    //       refreshProxy().catch((fallbackError) => {
    //         console.warn(
    //           "[AppDataProvider] 普通代理刷新也失败:",
    //           fallbackError,
    //         );
    //       });
    //     });
    // };

    const initializeListeners = async () => {
      try {
        const unlistenProfile = await listen<string>(
          "profile-changed",
          handleProfileChanged,
        );
        registerCleanup(unlistenProfile);
      } catch (error) {
        console.error("[AppDataProvider] 监听 Profile 事件失败:", error);
      }

      try {
        const unlistenClash = await listen(
          "verge://refresh-clash-config",
          handleRefreshClash,
        );
        const unlistenProxy = await listen(
          "verge://refresh-proxy-config",
          handleRefreshProxy,
        );
        // const unlistenForceRefresh = await listen(
        //   "verge://force-refresh-proxies",
        //   handleForceRefreshProxies,
        // );

        registerCleanup(() => {
          unlistenClash();
          unlistenProxy();
          // unlistenForceRefresh();
        });
      } catch (error) {
        console.warn("[AppDataProvider] 设置 Tauri 事件监听器失败:", error);

        const fallbackHandlers: Array<[string, EventListener]> = [
          ["verge://refresh-clash-config", handleRefreshClash],
          ["verge://refresh-proxy-config", handleRefreshProxy],
          // ["verge://force-refresh-proxies", handleForceRefreshProxies],
        ];

        fallbackHandlers.forEach(([eventName, handler]) => {
          window.addEventListener(eventName, handler);
          fallbackWindowListeners.push([eventName, handler]);
        });
      }
    };

    void initializeListeners();

    return () => {
      isUnmounted = true;
      clearAllTimeouts();
      fallbackWindowListeners.splice(0).forEach(([eventName, handler]) => {
        window.removeEventListener(eventName, handler);
      });
      cleanupFns.splice(0).forEach((fn) => fn());
    };
  }, [refreshProxy]);

  const { data: clashConfig, mutate: refreshClashConfig } = useSWR(
    "getClashConfig",
    getBaseConfig,
    {
      refreshInterval: 60000, // 60秒刷新间隔，减少频繁请求
      revalidateOnFocus: false,
      suspense: false,
      errorRetryCount: 3,
    },
  );

  // 提供者数据
  const { data: proxyProviders, mutate: refreshProxyProviders } = useSWR(
    "getProxyProviders",
    calcuProxyProviders,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 3000,
      suspense: false,
      errorRetryCount: 3,
    },
  );

  const { data: ruleProviders, mutate: refreshRuleProviders } = useSWR(
    "getRuleProviders",
    getRuleProviders,
    {
      revalidateOnFocus: false,
      suspense: false,
      errorRetryCount: 3,
    },
  );

  // 低频率更新数据
  const { data: rulesData, mutate: refreshRules } = useSWR(
    "getRules",
    getRules,
    {
      revalidateOnFocus: false,
      suspense: false,
      errorRetryCount: 3,
    },
  );

  const { data: sysproxy, mutate: refreshSysproxy } = useSWR(
    "getSystemProxy",
    getSystemProxy,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      suspense: false,
      errorRetryCount: 3,
    },
  );

  const { data: runningMode } = useSWR("getRunningMode", getRunningMode, {
    revalidateOnFocus: false,
    suspense: false,
    errorRetryCount: 3,
  });

  // 高频率更新数据 (2秒)
  const { data: uptimeData } = useSWR("appUptime", getAppUptime, {
    // TODO: 运行时间
    refreshInterval: 2000,
    revalidateOnFocus: false,
    suspense: false,
  });

  // 连接数据 - 使用IPC轮询更新并计算速度
  // const {
  //   data: connectionsData = {
  //     connections: [],
  //     uploadTotal: 0,
  //     downloadTotal: 0,
  //   },
  // } = useSWR(
  //   clashInfo && pageVisible ? "getConnections" : null,
  //   async () => {
  //     const data = await getConnections();
  //     const rawConnections =
  //       data.connections?.map((item) => {
  //         // TODO: transform bigint to number
  //         return { ...item, upload: 0, download: 0 } as IConnectionsItem;
  //       }) || [];

  //     // 计算带速度的连接数据
  //     const connectionsWithSpeed = calculateConnectionSpeeds(rawConnections);

  //     // 更新上一次数据的引用
  //     const currentMap = new Map<string, ConnectionSpeedData>();
  //     const now = Date.now();
  //     rawConnections.forEach((conn) => {
  //       currentMap.set(conn.id, {
  //         id: conn.id,
  //         upload: conn.upload,
  //         download: conn.download,
  //         timestamp: now,
  //       });
  //     });
  //     previousConnectionsRef.current = currentMap;

  //     return {
  //       connections: connectionsWithSpeed,
  //       uploadTotal: data.uploadTotal || 0,
  //       downloadTotal: data.downloadTotal || 0,
  //     };
  //   },
  //   {
  //     refreshInterval: 1000, // 1秒刷新一次
  //     fallbackData: { connections: [], uploadTotal: 0, downloadTotal: 0 },
  //     keepPreviousData: true,
  //     onError: (error) => {
  //       console.error("[Connections] IPC 获取数据错误:", error);
  //     },
  //   },
  // );

  // 流量数据 - 使用IPC轮询更新
  // const trafficData = { up: 0, down: 0 };
  // const { data: trafficData = { up: 0, down: 0 } } = useSWR(
  //   clashInfo && pageVisible ? "getTrafficData" : null,
  //   getTrafficData,
  //   {
  //     refreshInterval: 1000, // 1秒刷新一次
  //     fallbackData: { up: 0, down: 0 },
  //     keepPreviousData: true,
  //     onSuccess: () => {
  //       // console.log("[Traffic][AppDataProvider] IPC 获取到流量数据:", data);
  //     },
  //     onError: (error) => {
  //       console.error("[Traffic][AppDataProvider] IPC 获取数据错误:", error);
  //     },
  //   },
  // );

  // 内存数据 - 使用IPC轮询更新
  // const memoryData = { inuse: 0 };
  // const { data: memoryData = { inuse: 0 } } = useSWR(
  //   clashInfo && pageVisible ? "getMemoryData" : null,
  //   getMemoryData,
  //   {
  //     refreshInterval: 2000, // 2秒刷新一次
  //     fallbackData: { inuse: 0 },
  //     keepPreviousData: true,
  //     onError: (error) => {
  //       console.error("[Memory] IPC 获取数据错误:", error);
  //     },
  //   },
  // );

  // 提供统一的刷新方法
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshProxy(),
      refreshClashConfig(),
      refreshRules(),
      refreshSysproxy(),
      refreshProxyProviders(),
      refreshRuleProviders(),
    ]);
  }, [
    refreshProxy,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
  ]);

  // 聚合所有数据
  const value = useMemo(() => {
    // 计算系统代理地址
    const calculateSystemProxyAddress = () => {
      if (!verge || !clashConfig) return "-";

      const isPacMode = verge.proxy_auto_config ?? false;

      if (isPacMode) {
        // PAC模式：显示我们期望设置的代理地址
        const proxyHost = verge.proxy_host || "127.0.0.1";
        const proxyPort =
          verge.verge_mixed_port || clashConfig.mixedPort || 7897;
        return `${proxyHost}:${proxyPort}`;
      } else {
        // HTTP代理模式：优先使用系统地址，但如果格式不正确则使用期望地址
        const systemServer = sysproxy?.server;
        if (
          systemServer &&
          systemServer !== "-" &&
          !systemServer.startsWith(":")
        ) {
          return systemServer;
        } else {
          // 系统地址无效，返回期望的代理地址
          const proxyHost = verge.proxy_host || "127.0.0.1";
          const proxyPort =
            verge.verge_mixed_port || clashConfig.mixedPort || 7897;
          return `${proxyHost}:${proxyPort}`;
        }
      }
    };

    return {
      // 数据
      proxies: proxiesData,
      clashConfig,
      rules: rulesData?.rules || [],
      sysproxy,
      runningMode,
      uptime: uptimeData || 0,

      // 提供者数据
      proxyProviders: proxyProviders || {},
      ruleProviders: ruleProviders?.providers || {},

      // 连接数据
      // connections: {
      //   data: connectionsData.connections || [],
      //   count: connectionsData.connections?.length || 0,
      //   uploadTotal: connectionsData.uploadTotal || 0,
      //   downloadTotal: connectionsData.downloadTotal || 0,
      // },

      // 实时流量数据
      // traffic: trafficData,
      // memory: memoryData,

      systemProxyAddress: calculateSystemProxyAddress(),

      // 刷新方法
      refreshProxy,
      refreshClashConfig,
      refreshRules,
      refreshSysproxy,
      refreshProxyProviders,
      refreshRuleProviders,
      refreshAll,
    } as AppDataContextType;
  }, [
    proxiesData,
    clashConfig,
    rulesData,
    sysproxy,
    runningMode,
    uptimeData,
    // connectionsData,
    // trafficData,
    // memoryData,
    proxyProviders,
    ruleProviders,
    verge,
    refreshProxy,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
    refreshAll,
  ]);

  return <AppDataContext value={value}>{children}</AppDataContext>;
};
