import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

import { hideInitialOverlay } from "../utils";

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
      if (isCancelled) return;

      try {
        if (stage) {
          await invoke("update_ui_stage", { stage });
        } else {
          await invoke("notify_ui_ready");
        }
      } catch (err) {
        console.error(`[Initialization] Failed to notify backend:`, err);
      }
    };

    const removeLoadingOverlay = () => {
      hideInitialOverlay({ schedule: scheduleTimeout });
    };

    const performInitialization = async () => {
      if (isCancelled || isInitialized) return;
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
        if (!isCancelled) {
          console.error("[Initialization] Failed:", error);
          removeLoadingOverlay();
          notifyBackend().catch(console.error);
        }
      }
    };

    const checkBackendReady = async () => {
      try {
        if (isCancelled) return;

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
          console.warn("[Initialization] Failed to clear timer:", error);
        }
      });
      timers.clear();
    };
  }, []);
};
