import { event } from "@tauri-apps/api";
import { listen, UnlistenFn, EventCallback } from "@tauri-apps/api/event";
import { useCallback, useRef } from "react";

export const useListen = () => {
  const unlistenFnsRef = useRef<UnlistenFn[]>([]);

  const addListener = useCallback(
    async <T>(eventName: string, handler: EventCallback<T>) => {
      const unlisten = await listen(eventName, handler);
      unlistenFnsRef.current.push(unlisten);
      return unlisten;
    },
    [],
  );

  const removeAllListeners = useCallback(() => {
    const errors: Error[] = [];

    unlistenFnsRef.current.forEach((unlisten) => {
      try {
        unlisten();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    });

    if (errors.length > 0) {
      console.warn(
        `[useListen] 清理监听器时发生 ${errors.length} 个错误`,
        errors,
      );
    }

    unlistenFnsRef.current.length = 0;
  }, []);

  const setupCloseListener = useCallback(async () => {
    await event.once("tauri://close-requested", async () => {
      removeAllListeners();
    });
  }, [removeAllListeners]);

  return {
    addListener,
    removeAllListeners,
    setupCloseListener,
  };
};
