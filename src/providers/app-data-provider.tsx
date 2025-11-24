import { listen } from "@tauri-apps/api/event";
import { PropsWithChildren, useCallback, useEffect } from "react";
import { useSWRConfig } from "swr";

// 负责监听全局事件并驱动 SWR 刷新，避免包裹全局 context 带来的额外渲染
export const AppDataProvider = ({ children }: PropsWithChildren) => {
  useAppDataEventBridge();
  return <>{children}</>;
};

const useAppDataEventBridge = () => {
  const { mutate } = useSWRConfig();

  const refreshProxy = useCallback(() => mutate("getProxies"), [mutate]);
  const refreshClashConfig = useCallback(
    () => mutate("getClashConfig"),
    [mutate],
  );
  const refreshRules = useCallback(() => mutate("getRules"), [mutate]);
  const refreshRuleProviders = useCallback(
    () => mutate("getRuleProviders"),
    [mutate],
  );

  useEffect(() => {
    let lastProfileId: string | null = null;
    let lastUpdateTime = 0;
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

    const handleProfileChanged = (event: { payload: string }) => {
      const newProfileId = event.payload;
      const now = Date.now();

      if (
        lastProfileId === newProfileId &&
        now - lastUpdateTime < refreshThrottle
      ) {
        return;
      }

      lastProfileId = newProfileId;
      lastUpdateTime = now;

      scheduleTimeout(() => {
        refreshRules().catch((error) =>
          console.warn("[DataProvider] Rules refresh failed:", error),
        );
        refreshRuleProviders().catch((error) =>
          console.warn("[DataProvider] Rule providers refresh failed:", error),
        );
      }, 200);
    };

    const handleRefreshClash = () => {
      const now = Date.now();
      if (now - lastUpdateTime <= refreshThrottle) return;

      lastUpdateTime = now;
      scheduleTimeout(async () => {
        await Promise.all([
          refreshProxy().catch((error) =>
            console.error("[DataProvider] Proxy refresh failed:", error),
          ),
          refreshClashConfig().catch((error) =>
            console.error("[DataProvider] Clash config refresh failed:", error),
          ),
        ]);
      }, 200);
    };

    const handleRefreshProxy = () => {
      const now = Date.now();
      if (now - lastUpdateTime <= refreshThrottle) return;

      lastUpdateTime = now;
      scheduleTimeout(() => {
        refreshProxy().catch((error) =>
          console.warn("[DataProvider] Proxy refresh failed:", error),
        );
      }, 200);
    };

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

        registerCleanup(() => {
          unlistenClash();
          unlistenProxy();
        });
      } catch (error) {
        console.warn("[AppDataProvider] 设置 Tauri 事件监听器失败:", error);

        const fallbackHandlers: Array<[string, EventListener]> = [
          ["verge://refresh-clash-config", handleRefreshClash],
          ["verge://refresh-proxy-config", handleRefreshProxy],
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
          "[DataProvider] " + errors.length + " errors during cleanup:",
          errors,
        );
      }
    };
  }, [refreshProxy, refreshClashConfig, refreshRules, refreshRuleProviders]);
};
