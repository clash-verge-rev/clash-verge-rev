import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import useSWR, { mutate as globalMutate } from "swr";
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
  getProfileSwitchEvents,
  getProfiles as fetchProfilesConfig,
  getRunningMode,
  readProfileFile,
  getSystemProxy,
  type ProxiesView,
  type ProfileSwitchStatus,
  type SwitchResultStatus,
} from "@/services/cmds";
import { SWR_DEFAULTS, SWR_SLOW_POLL } from "@/services/config";
import { useProfileStore } from "@/stores/profile-store";
import {
  applyLiveProxyPayload,
  fetchLiveProxies,
  type ProxiesUpdatedPayload,
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
  const applyProfileSwitchResult = useProfileStore(
    (state) => state.applySwitchResult,
  );
  const commitProfileSnapshot = useProfileStore(
    (state) => state.commitHydrated,
  );
  const setSwitchEventSeq = useProfileStore((state) => state.setLastEventSeq);
  const proxyView = useProxyStore((state) => state.data);
  const proxyHydration = useProxyStore((state) => state.hydration);
  const proxyProfileId = useProxyStore((state) => state.lastProfileId);
  const pendingProxyProfileId = useProxyStore(
    (state) => state.pendingProfileId,
  );
  const setProxySnapshot = useProxyStore((state) => state.setSnapshot);
  const clearPendingProxyProfile = useProxyStore(
    (state) => state.clearPendingProfile,
  );

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

  const { data: switchStatus, mutate: mutateSwitchStatus } =
    useSWR<ProfileSwitchStatus>(
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

  const isUnmountedRef = useRef(false);
  // Keep track of pending timers so we can cancel them on unmount and avoid stray updates.
  const scheduledTimeoutsRef = useRef<Set<number>>(new Set());
  // Shared metadata to dedupe switch events coming from both polling and subscriptions.
  const switchMetaRef = useRef<{
    pendingProfileId: string | null;
    lastResultTaskId: number | null;
  }>({
    pendingProfileId: null,
    lastResultTaskId: null,
  });
  const switchEventSeqRef = useRef(0);

  // Thin wrapper around setTimeout that no-ops once the provider unmounts.
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

  // Delay live proxy refreshes slightly so we don't hammer Mihomo while a switch is still applying.
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
  // Prime the proxy store with the static selections from the profile YAML before live data arrives.
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

  const handleSwitchResult = useCallback(
    (result: SwitchResultStatus) => {
      // Ignore duplicate notifications for the same switch execution.
      const meta = switchMetaRef.current;
      if (result.taskId === meta.lastResultTaskId) {
        return;
      }
      meta.lastResultTaskId = result.taskId;

      // Optimistically update the SWR cache so the UI shows the new profile immediately.
      void globalMutate(
        "getProfiles",
        (current?: IProfilesConfig | null) => {
          if (!current || !result.success) {
            return current;
          }
          if (current.current === result.profileId) {
            return current;
          }
          return {
            ...current,
            current: result.profileId,
          };
        },
        false,
      );

      applyProfileSwitchResult(result);
      if (!result.success) {
        clearPendingProxyProfile();
      }

      if (result.success && result.cancelled !== true) {
        // Once the backend settles, refresh all dependent data in the background.
        scheduleTimeout(() => {
          void Promise.allSettled([
            fetchProfilesConfig().then((data) => {
              commitProfileSnapshot(data);
              globalMutate("getProfiles", data, false);
            }),
            fetchLiveProxies(),
            refreshProxyProviders(),
            refreshRules(),
            refreshRuleProviders(),
          ]).catch((error) => {
            console.warn(
              "[DataProvider] Background refresh after profile switch failed:",
              error,
            );
          });
        }, 100);
      }

      void mutateSwitchStatus((current) => {
        if (!current) {
          return current;
        }
        const filteredQueue = current.queue.filter(
          (task) => task.taskId !== result.taskId,
        );
        const active =
          current.active && current.active.taskId === result.taskId
            ? null
            : current.active;
        const isSwitching = filteredQueue.length > 0;
        return {
          ...current,
          active,
          queue: filteredQueue,
          isSwitching,
          lastResult: result,
        };
      }, false);
    },
    [
      scheduleTimeout,
      refreshProxyProviders,
      refreshRules,
      refreshRuleProviders,
      mutateSwitchStatus,
      applyProfileSwitchResult,
      commitProfileSnapshot,
      clearPendingProxyProfile,
    ],
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
    if (lastResult) {
      handleSwitchResult(lastResult);
    }
  }, [switchStatus, seedProxySnapshot, handleSwitchResult]);

  useEffect(() => {
    let disposed = false;

    const pollEvents = async () => {
      if (disposed) {
        return;
      }
      try {
        const events = await getProfileSwitchEvents(switchEventSeqRef.current);
        if (events.length > 0) {
          switchEventSeqRef.current = events[events.length - 1].sequence;
          setSwitchEventSeq(switchEventSeqRef.current);
          events.forEach((event) => handleSwitchResult(event.result));
        }
      } catch (error) {
        console.warn("[DataProvider] Failed to poll switch events:", error);
      } finally {
        if (!disposed) {
          const nextDelay =
            switchStatus &&
            (switchStatus.isSwitching || (switchStatus.queue?.length ?? 0) > 0)
              ? 250
              : 1000;
          scheduleTimeout(pollEvents, nextDelay);
        }
      }
    };

    scheduleTimeout(pollEvents, 0);

    return () => {
      disposed = true;
    };
  }, [scheduleTimeout, handleSwitchResult, switchStatus, setSwitchEventSeq]);

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

    const isProxiesPayload = (
      value: unknown,
    ): value is ProxiesUpdatedPayload => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const candidate = value as Partial<ProxiesUpdatedPayload>;
      return candidate.proxies !== undefined && candidate.proxies !== null;
    };

    const handleProxiesUpdatedPayload = (
      rawPayload: unknown,
      source: "tauri" | "window",
    ) => {
      if (!isProxiesPayload(rawPayload)) {
        console.warn(
          `[AppDataProvider] Ignored ${source} proxies-updated payload`,
          rawPayload,
        );
        queueProxyRefresh(`proxies-updated-${source}-invalid`, 500);
        return;
      }

      try {
        applyLiveProxyPayload(rawPayload);
      } catch (error) {
        console.warn(
          `[AppDataProvider] Failed to apply ${source} proxies-updated payload`,
          error,
        );
        queueProxyRefresh(`proxies-updated-${source}-apply-failed`, 500);
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

    listen<ProxiesUpdatedPayload>("proxies-updated", (event) => {
      handleProxiesUpdatedPayload(event.payload, "tauri");
    })
      .then(registerCleanup)
      .catch((error) =>
        console.error(
          "[AppDataProvider] failed to attach proxies-updated listener:",
          error,
        ),
      );

    listen("verge://refresh-proxy-config", () => {
      queueProxyRefresh("refresh-proxy-config-tauri", 500);
    })
      .then(registerCleanup)
      .catch((error) =>
        console.error(
          "[AppDataProvider] failed to attach refresh-proxy-config listener:",
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
      [
        "proxies-updated",
        ((event: Event) => {
          const payload = (event as CustomEvent<ProxiesUpdatedPayload>).detail;
          handleProxiesUpdatedPayload(payload, "window");
        }) as EventListener,
      ],
      [
        "verge://refresh-proxy-config",
        (() => {
          queueProxyRefresh("refresh-proxy-config-window", 500);
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

  const proxyTargetProfileId =
    switchTargetProfileId ?? pendingProxyProfileId ?? proxyProfileId ?? null;
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
