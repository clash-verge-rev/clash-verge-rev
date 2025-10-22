import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

export const useAppInitialization = () => {
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    let isInitialized = false;
    let isCancelled = false;
    const timers = new Set<number>();

    const scheduleTimeout = (handler: () => void, delay: number) => {
      if (isCancelled) return -1;
      const id = window.setTimeout(() => {
        if (!isCancelled) {
          handler();
        }
        timers.delete(id);
      }, delay);
      timers.add(id);
      return id;
    };

    const notifyBackend = async (stage?: string) => {
      try {
        if (stage) {
          await invoke("update_ui_stage", { stage });
        } else {
          await invoke("notify_ui_ready");
        }
      } catch (err) {
        console.error(`[初始化] 通知后端失败:`, err);
      }
    };

    const removeLoadingOverlay = () => {
      const overlay = document.getElementById("initial-loading-overlay");
      if (overlay) {
        overlay.style.opacity = "0";
        scheduleTimeout(() => overlay.remove(), 300);
      }
    };

    const performInitialization = async () => {
      if (isInitialized) return;
      isInitialized = true;

      try {
        removeLoadingOverlay();
        await notifyBackend("Loading");

        await new Promise<void>((resolve) => {
          const check = () => {
            const root = document.getElementById("root");
            if (root && root.children.length > 0) {
              resolve();
            } else {
              scheduleTimeout(check, 50);
            }
          };
          check();
          scheduleTimeout(resolve, 2000);
        });

        await notifyBackend("DomReady");
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await notifyBackend("ResourcesLoaded");
        await notifyBackend();
      } catch (error) {
        console.error("[初始化] 失败:", error);
        removeLoadingOverlay();
        notifyBackend().catch(console.error);
      }
    };

    const checkBackendReady = async () => {
      try {
        await invoke("update_ui_stage", { stage: "Loading" });
        performInitialization();
      } catch {
        scheduleTimeout(performInitialization, 1500);
      }
    };

    scheduleTimeout(checkBackendReady, 100);
    scheduleTimeout(() => {
      if (!isInitialized) {
        removeLoadingOverlay();
        notifyBackend().catch(console.error);
      }
    }, 5000);

    return () => {
      isCancelled = true;
      timers.forEach((id) => {
        try {
          window.clearTimeout(id);
        } catch (error) {
          console.warn("[初始化] 清理定时器失败:", error);
        }
      });
      timers.clear();
    };
  }, []);
};
