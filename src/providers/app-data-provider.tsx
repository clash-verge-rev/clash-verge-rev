import { listen } from "@tauri-apps/api/event";
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
  getProfileSwitchStatus,
  getRunningMode,
  readProfileFile,
  getSystemProxy,
  type ProxiesView,
  type ProfileSwitchStatus,
} from "@/services/cmds";
import { SWR_DEFAULTS, SWR_SLOW_POLL } from "@/services/config";
import {
  applyLiveProxyPayload,
  fetchLiveProxies,
  useProxyStore,
  type ProxiesUpdatedPayload,
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

  const { data: switchStatus } = useSWR<ProfileSwitchStatus>(
    "getProfileSwitchStatus",
    getProfileSwitchStatus,
    {
      refreshInterval: (status) =>
        status && (status.isSwitching || (status.queue?.length ?? 0) > 0)
          ? 400
          : 4000,
      dedupingInterval: 200,
    },
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
    let disposed = false;
    let fallbackTimeout: number | null = null;

    const scheduleFallbackFetch = (delay = 400) => {
      if (fallbackTimeout !== null) {
        window.clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
      }
      fallbackTimeout = window.setTimeout(() => {
        fallbackTimeout = null;
        if (disposed) return;
        fetchLiveProxies().catch((error) =>
          console.warn(
            "[DataProvider] Live proxy fallback refresh failed:",
            error,
          ),
        );
      }, delay);
    };

    fetchLiveProxies().catch((error) => {
      console.error("[DataProvider] Initial proxy fetch failed:", error);
    });

    const attach = listen<ProxiesUpdatedPayload>("proxies-updated", (event) => {
      if (disposed) return;
      const payload = event.payload;
      if (!payload) return;
      applyLiveProxyPayload(payload);
      scheduleFallbackFetch(600);
    })
      .then((unlisten) => unlisten)
      .catch((error) => {
        console.error(
          "[DataProvider] Failed to attach proxies-updated listener:",
          error,
        );
        return null;
      });

    return () => {
      disposed = true;
      if (fallbackTimeout !== null) {
        window.clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
      }
      attach.then((cleanup) => {
        if (cleanup) {
          cleanup();
        }
      });
    };
  }, []);

  const isUnmountedRef = useRef(false);
  const scheduledTimeoutsRef = useRef<Set<number>>(new Set());
  const switchMetaRef = useRef<{
    pendingProfileId: string | null;
    lastResultFinishedAt: number | null;
  }>({
    pendingProfileId: null,
    lastResultFinishedAt: null,
  });

  const scheduleTimeout = useCallback(
    (callback: () => void | Promise<void>, delay: number) => {
      if (isUnmountedRef.current) return -1;

      const timeoutId = window.setTimeout(() => {
        scheduledTimeoutsRef.current.delete(timeoutId);
        if (!isUnmountedRef.current) {
          void callback();
        }
      }, delay);

      scheduledTimeoutsRef.current.add(timeoutId);
      return timeoutId;
    },
    [],
  );

  const clearAllTimeouts = useCallback(() => {
    scheduledTimeoutsRef.current.forEach((timeoutId) =>
      clearTimeout(timeoutId),
    );
    scheduledTimeoutsRef.current.clear();
  }, []);

  const queueProxyRefresh = useCallback(
    (reason: string, delay = 1500) => {
      scheduleTimeout(() => {
        fetchLiveProxies().catch((error) =>
          console.warn(
            `[DataProvider] Proxy refresh failed (${reason}, fallback):`,
            error,
          ),
        );
      }, delay);
    },
    [scheduleTimeout],
  );

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  useEffect(() => {
    if (!switchStatus) {
      return;
    }

    const meta = switchMetaRef.current;
    const nextTarget =
      switchStatus.active?.profileId ??
      (switchStatus.queue.length > 0 ? switchStatus.queue[0].profileId : null);

    if (nextTarget && nextTarget !== meta.pendingProfileId) {
      meta.pendingProfileId = nextTarget;
      void seedProxySnapshot(nextTarget);
    } else if (!nextTarget) {
      meta.pendingProfileId = null;
    }

    const lastResult = switchStatus.lastResult ?? null;
    if (lastResult && lastResult.finishedAt !== meta.lastResultFinishedAt) {
      meta.lastResultFinishedAt = lastResult.finishedAt;

      queueProxyRefresh("profile-switch-finished");
      void refreshProxyProviders()
        .catch((error) =>
          console.warn(
            "[DataProvider] Proxy providers refresh failed after profile switch:",
            error,
          ),
        )
        .then(() => refreshRules())
        .catch((error) =>
          console.warn(
            "[DataProvider] Rules refresh failed after profile switch:",
            error,
          ),
        )
        .then(() => refreshRuleProviders())
        .catch((error) =>
          console.warn(
            "[DataProvider] Rule providers refresh failed after profile switch:",
            error,
          ),
        );
    }
  }, [
    switchStatus,
    seedProxySnapshot,
    queueProxyRefresh,
    refreshProxyProviders,
    refreshRules,
    refreshRuleProviders,
  ]);

  useEffect(() => {
    const cleanupFns: Array<() => void> = [];

    const registerCleanup = (fn: () => void) => {
      cleanupFns.push(fn);
    };

    const addWindowListener = (eventName: string, handler: EventListener) => {
      // eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener
      window.addEventListener(eventName, handler);
      return () => window.removeEventListener(eventName, handler);
    };

    const handleProfileUpdateCompleted = (_: { payload: { uid: string } }) => {
      queueProxyRefresh("profile-update-completed", 3000);
      if (!isUnmountedRef.current) {
        scheduleTimeout(() => {
          void refreshProxyProviders().catch((error) =>
            console.warn(
              "[DataProvider] Proxy providers refresh failed after profile update completed:",
              error,
            ),
          );
        }, 0);
      }
    };

    listen<{ uid: string }>(
      "profile-update-completed",
      handleProfileUpdateCompleted,
    )
      .then(registerCleanup)
      .catch((error) =>
        console.error(
          "[AppDataProvider] failed to attach profile update listeners:",
          error,
        ),
      );

    const fallbackHandlers: Array<[string, EventListener]> = [
      [
        "profile-update-completed",
        ((event: Event) => {
          const payload = (event as CustomEvent<{ uid: string }>).detail ?? {
            uid: "",
          };
          handleProfileUpdateCompleted({ payload });
        }) as EventListener,
      ],
    ];

    fallbackHandlers.forEach(([eventName, handler]) => {
      registerCleanup(addWindowListener(eventName, handler));
    });

    return () => {
      cleanupFns.forEach((fn) => {
        try {
          fn();
        } catch (error) {
          console.error("[AppDataProvider] cleanup error:", error);
        }
      });
    };
  }, [queueProxyRefresh, refreshProxyProviders, scheduleTimeout]);

  const switchTargetProfileId =
    switchStatus?.active?.profileId ??
    (switchStatus && switchStatus.queue.length > 0
      ? switchStatus.queue[0].profileId
      : null);

  const proxyTargetProfileId = switchTargetProfileId ?? proxyProfileId ?? null;
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
    (switchStatus?.isSwitching ?? false) ||
    proxyHydration !== "live" ||
    proxyTargetProfileId !== proxyDisplayProfileId;

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
      switchStatus: switchStatus ?? null,
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
    switchStatus,
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
