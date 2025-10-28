import { event } from "@tauri-apps/api";
import { listen, UnlistenFn, EventCallback } from "@tauri-apps/api/event";
import { useRef } from "react";

export const useListen = () => {
  const unlistenFns = useRef<UnlistenFn[]>([]);

  const addListener = async <T>(
    eventName: string,
    handler: EventCallback<T>,
  ) => {
    const unlisten = await listen(eventName, handler);
    unlistenFns.current.push(unlisten);
    return unlisten;
  };

  const removeAllListeners = () => {
    const errors: Error[] = [];

    unlistenFns.current.forEach((unlisten) => {
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

    unlistenFns.current.length = 0;
  };

  const setupCloseListener = async function () {
    await event.once("tauri://close-requested", async () => {
      removeAllListeners();
    });
  };

  return {
    addListener,
    removeAllListeners,
    setupCloseListener,
  };
};
