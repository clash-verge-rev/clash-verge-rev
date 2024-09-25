import { listen, UnlistenFn, EventCallback } from "@tauri-apps/api/event";
import { event } from "@tauri-apps/api";

export const useListen = () => {
  let unlistenFns: UnlistenFn[] = [];

  const addListener = async function <T>(
    eventName: string,
    handler: EventCallback<T>
  ) {
    const unlisten = await listen(eventName, handler);
    unlistenFns.push(unlisten);
    return unlisten;
  };
  const removeAllListeners = async function () {
    for (const unlisten of unlistenFns) {
      Promise.resolve(unlisten()).catch(console.error);
    }
    unlistenFns = [];
  };

  const setupCloseListener = async function () {
    await event.once("tauri://close-requested", async () => {
      console.log("Window close requested.");
      await removeAllListeners();
    });
  };

  return {
    addListener,
    removeAllListeners,
    setupCloseListener,
  };
};
