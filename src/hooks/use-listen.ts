import { listen, UnlistenFn, EventCallback } from "@tauri-apps/api/event";
import { event } from "@tauri-apps/api";
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
    unlistenFns.current.forEach((unlisten) => unlisten());
    unlistenFns.current = [];
  };

  const setupCloseListener = async function () {
    await event.once("tauri://close-requested", async () => {
      removeAllListeners();
    });
  };

  return {
    addListener,
    setupCloseListener,
  };
};
