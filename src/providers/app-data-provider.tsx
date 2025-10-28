import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import {
  getBaseConfig,
  getRuleProviders,
  getRules,
} from "tauri-plugin-mihomo-api";

import { useVerge } from "@/hooks/use-verge";
import {
  calcuProxyProviders,
  getAppUptime,
  getRunningMode,
  readProfileFile,
  getSystemProxy,
  type ProxiesView,
} from "@/services/cmds";
import { SWR_DEFAULTS, SWR_SLOW_POLL } from "@/services/config";
import {
  ensureProxyEventBridge,
  fetchLiveProxies,
  useProxyStore,
} from "@/stores/proxy-store";
import { createProxySnapshotFromProfile } from "@/utils/proxy-snapshot";

import { AppDataContext, AppDataContextType } from "./app-data-context";

// Global app data provider
export const AppDataProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { verge } = useVerge();
  const proxyView = useProxyStore((state) => state.data);
  const proxyHydration = useProxyStore((state) => state.hydration);
  const proxyProfileId = useProxyStore((state) => state.lastProfileId);
  const setProxySnapshot = useProxyStore((state) => state.setSnapshot);

  const { data: clashConfig, mutate: refreshClashConfig } = useSWR(
    "getClashConfig",
    getBaseConfig,
    SWR_SLOW_POLL,
  );

  const { data: proxyProviders, mutate: refreshProxyProviders } = useSWR(
    "getProxyProviders",
    calcuProxyProviders,
    SWR_DEFAULTS,
  );

  const { data: ruleProviders, mutate: refreshRuleProviders } = useSWR(
    "getRuleProviders",
    getRuleProviders,
    SWR_DEFAULTS,
  );

  const { data: rulesData, mutate: refreshRules } = useSWR(
    "getRules",
    getRules,
    SWR_DEFAULTS,
  );

  const seedProxySnapshot = useCallback(
    async (profileId: string) => {
      if (!profileId) return;

      try {
        const yamlContent = await readProfileFile(profileId);
        const snapshot = createProxySnapshotFromProfile(yamlContent);
        if (!snapshot) return;

        setProxySnapshot(snapshot, profileId);
      } catch (error) {
        console.warn(
          "[DataProvider] Failed to seed proxy snapshot from profile:",
          error,
        );
      }
    },
    [setProxySnapshot],
  );

  useEffect(() => {
    let unlistenBridge: UnlistenFn | null = null;

    ensureProxyEventBridge()
      .then((unlisten) => {
        unlistenBridge = unlisten;
      })
      .catch((error) => {
        console.error(
          "[DataProvider] Failed to establish proxy bridge:",
          error,
        );
      });

    fetchLiveProxies().catch((error) => {
      console.error("[DataProvider] Initial proxy fetch failed:", error);
    });

    return () => {
      if (unlistenBridge) {
        void unlistenBridge();
      }
    };
  }, []);

  useEffect(() => {
    let lastProfileId: string | null = null;
    let lastProfileChangeTime = 0;
    let lastProxyRefreshTime = 0;
    let lastClashRefreshTime = 0;
    const refreshThrottle = 800;

    let isUnmounted = false;
    const scheduledTimeouts = new Set<number>();
    const cleanupFns: Array<() => void> = [];

    const registerCleanup = (fn: () => void) => {
      if (isUnmounted) {
        try {
          fn();
        } catch (error) {
          console.error("[DataProvider] Immediate cleanup failed:", error);
        }
      } else {
        cleanupFns.push(fn);
      }
    };

    const addWindowListener = (eventName: string, handler: EventListener) => {
      // eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener
      window.addEventListener(eventName, handler);
      return () => window.removeEventListener(eventName, handler);
    };

    const scheduleTimeout = (
      callback: () => void | Promise<void>,
      delay: number,
    ) => {
      if (isUnmounted) return -1;

      const timeoutId = window.setTimeout(() => {
        scheduledTimeouts.delete(timeoutId);
        if (!isUnmounted) {
          void callback();
        }
      }, delay);

      scheduledTimeouts.add(timeoutId);
      return timeoutId;
    };

    const clearAllTimeouts = () => {
      scheduledTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      scheduledTimeouts.clear();
    };

    const queueProxyRefresh = (
      reason: string,
      delays: number[] = [0, 250, 1000, 2000],
    ) => {
      delays.forEach((delay) => {
        scheduleTimeout(() => {
          fetchLiveProxies().catch((error) =>
            console.warn(
              `[DataProvider] Proxy refresh failed (${reason}, +${delay}ms):`,
              error,
            ),
          );
        }, delay);
      });
    };

    const handleProfileChanged = (event: { payload: string }) => {
      const newProfileId = event.payload;
      const now = Date.now();
      if (
        lastProfileId === newProfileId &&
        now - lastProfileChangeTime < refreshThrottle
      ) {
        return;
      }

      lastProfileId = newProfileId;
      lastProfileChangeTime = now;
      lastProxyRefreshTime = 0;
      lastClashRefreshTime = 0;

      void seedProxySnapshot(newProfileId);

      scheduleTimeout(() => {
        queueProxyRefresh("profile-change");
        void refreshProxyProviders()
          .then(() => {
            queueProxyRefresh("profile-change:providers", [0, 500, 1500]);
          })
          .catch((error) =>
            console.warn(
              "[DataProvider] Proxy providers refresh failed after profile change:",
              error,
            ),
          );

        refreshRules().catch((error) =>
          console.warn("[DataProvider] Rules refresh failed:", error),
        );
        refreshRuleProviders().catch((error) =>
          console.warn("[DataProvider] Rule providers refresh failed:", error),
        );
      }, 200);
    };

    const handleProfileUpdateCompleted = (_: { payload: { uid: string } }) => {
      const now = Date.now();
      lastProxyRefreshTime = now;
      lastClashRefreshTime = now;
      scheduleTimeout(() => {
        queueProxyRefresh("profile-update-completed");
        void refreshProxyProviders()
          .then(() => {
            queueProxyRefresh(
              "profile-update-completed:providers",
              [0, 500, 1500],
            );
          })
          .catch((error) =>
            console.warn(
              "[DataProvider] Proxy providers refresh failed after profile update completed:",
              error,
            ),
          );
      }, 120);
    };

    const handleRefreshClash = () => {
      const now = Date.now();
      if (now - lastClashRefreshTime <= refreshThrottle) return;

      lastClashRefreshTime = now;
      scheduleTimeout(() => {
        queueProxyRefresh("refresh-clash");
      }, 200);
    };

    const handleRefreshProxy = () => {
      const now = Date.now();
      if (now - lastProxyRefreshTime <= refreshThrottle) return;

      lastProxyRefreshTime = now;
      scheduleTimeout(() => {
        queueProxyRefresh("refresh-proxy");
      }, 200);
    };

    const initializeListeners = async () => {
      try {
        const unlistenProfile = await listen<string>(
          "profile-changed",
          handleProfileChanged,
        );
        const unlistenProfileCompleted = await listen<{
          uid: string;
        }>("profile-update-completed", handleProfileUpdateCompleted);

        registerCleanup(unlistenProfile);
        registerCleanup(unlistenProfileCompleted);
      } catch (error) {
        console.error(
          "[AppDataProvider] failed to attach profile listeners:",
          error,
        );
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

        registerCleanup(() => {
          unlistenClash();
          unlistenProxy();
        });
      } catch (error) {
        console.warn(
          "[AppDataProvider] failed to register Tauri event listener",
          error,
        );

        const fallbackHandlers: Array<[string, EventListener]> = [
          ["verge://refresh-clash-config", handleRefreshClash],
          ["verge://refresh-proxy-config", handleRefreshProxy],
          [
            "profile-update-completed",
            ((event: Event) => {
              const payload = (event as CustomEvent<{ uid: string }>)
                .detail ?? {
                uid: "",
              };
              handleProfileUpdateCompleted({ payload });
            }) as EventListener,
          ],
        ];

        fallbackHandlers.forEach(([eventName, handler]) => {
          registerCleanup(addWindowListener(eventName, handler));
        });
      }
    };

    void initializeListeners();

    return () => {
      isUnmounted = true;
      clearAllTimeouts();

      const errors: Error[] = [];
      cleanupFns.splice(0).forEach((fn) => {
        try {
          fn();
        } catch (error) {
          errors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });

      if (errors.length > 0) {
        console.error(
          `[DataProvider] ${errors.length} errors during cleanup:`,
          errors,
        );
      }
    };
  }, [
    refreshProxyProviders,
    refreshRules,
    refreshRuleProviders,
    seedProxySnapshot,
  ]);

  const proxyTargetProfileId = proxyProfileId ?? null;
  const displayProxyStateRef = useRef<{
    view: ProxiesView | null;
    profileId: string | null;
  }>({
    view: proxyView,
    profileId: proxyTargetProfileId,
  });

  const currentDisplay = displayProxyStateRef.current;

  if (!proxyView) {
    if (
      currentDisplay.view !== null ||
      currentDisplay.profileId !== proxyTargetProfileId
    ) {
      displayProxyStateRef.current = {
        view: null,
        profileId: proxyTargetProfileId,
      };
    }
  } else if (proxyHydration === "live") {
    if (
      currentDisplay.view !== proxyView ||
      currentDisplay.profileId !== proxyTargetProfileId
    ) {
      displayProxyStateRef.current = {
        view: proxyView,
        profileId: proxyTargetProfileId,
      };
    }
  } else if (!currentDisplay.view) {
    displayProxyStateRef.current = {
      view: proxyView,
      profileId: proxyTargetProfileId,
    };
  }
  const displayProxyState = displayProxyStateRef.current;
  const proxyDisplayProfileId = displayProxyState.profileId;
  const proxiesForRender = displayProxyState.view ?? proxyView;
  const isProxyRefreshPending =
    proxyHydration !== "live" || proxyTargetProfileId !== proxyDisplayProfileId;

  const { data: sysproxy, mutate: refreshSysproxy } = useSWR(
    "getSystemProxy",
    getSystemProxy,
    SWR_DEFAULTS,
  );

  const { data: runningMode } = useSWR(
    "getRunningMode",
    getRunningMode,
    SWR_DEFAULTS,
  );

  const { data: uptimeData } = useSWR("appUptime", getAppUptime, {
    ...SWR_DEFAULTS,
    refreshInterval: 3000,
    errorRetryCount: 1,
  });

  // Provide unified refresh method
  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchLiveProxies(),
      refreshClashConfig(),
      refreshRules(),
      refreshSysproxy(),
      refreshProxyProviders(),
      refreshRuleProviders(),
    ]);
  }, [
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
  ]);

  // Aggregate data into context value
  const value = useMemo(() => {
    // Compute the system proxy address
    const calculateSystemProxyAddress = () => {
      if (!verge || !clashConfig) return "-";

      const isPacMode = verge.proxy_auto_config ?? false;

      if (isPacMode) {
        // PAC mode: display the desired proxy address
        const proxyHost = verge.proxy_host || "127.0.0.1";
        const proxyPort =
          verge.verge_mixed_port || clashConfig.mixedPort || 7897;
        return `${proxyHost}:${proxyPort}`;
      } else {
        // HTTP proxy mode: prefer system address, fallback to desired address if invalid
        const systemServer = sysproxy?.server;
        if (
          systemServer &&
          systemServer !== "-" &&
          !systemServer.startsWith(":")
        ) {
          return systemServer;
        } else {
          // System address invalid: fallback to desired proxy address
          const proxyHost = verge.proxy_host || "127.0.0.1";
          const proxyPort =
            verge.verge_mixed_port || clashConfig.mixedPort || 7897;
          return `${proxyHost}:${proxyPort}`;
        }
      }
    };

    return {
      // Data
      proxies: proxiesForRender,
      proxyHydration,
      proxyTargetProfileId,
      proxyDisplayProfileId,
      isProxyRefreshPending,
      clashConfig,
      rules: rulesData?.rules || [],
      sysproxy,
      runningMode,
      uptime: uptimeData || 0,

      // Provider data
      proxyProviders: proxyProviders || {},
      ruleProviders: ruleProviders?.providers || {},

      systemProxyAddress: calculateSystemProxyAddress(),

      // Refresh helpers
      refreshProxy: fetchLiveProxies,
      refreshClashConfig,
      refreshRules,
      refreshSysproxy,
      refreshProxyProviders,
      refreshRuleProviders,
      refreshAll,
    } as AppDataContextType;
  }, [
    proxiesForRender,
    proxyHydration,
    proxyTargetProfileId,
    proxyDisplayProfileId,
    isProxyRefreshPending,
    clashConfig,
    rulesData,
    sysproxy,
    runningMode,
    uptimeData,
    proxyProviders,
    ruleProviders,
    verge,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
    refreshAll,
  ]);

  return <AppDataContext value={value}>{children}</AppDataContext>;
};
