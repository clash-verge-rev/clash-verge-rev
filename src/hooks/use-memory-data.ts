import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

import { useMihomoWsSubscription } from "./use-mihomo-ws-subscription";

export interface IMemoryUsageItem {
  inuse: number;
  oslimit?: number;
}

const FALLBACK_MEMORY_USAGE: IMemoryUsageItem = { inuse: 0 };

export const useMemoryData = () => {
  const { response, refresh } = useMihomoWsSubscription<IMemoryUsageItem>({
    storageKey: "mihomo_memory_date",
    buildSubscriptKey: (date) => `getClashMemory-${date}`,
    fallbackData: FALLBACK_MEMORY_USAGE,
    connect: () => MihomoWebSocket.connect_memory(),
    setupHandlers: ({ next, scheduleReconnect }) => ({
      handleMessage: (data) => {
        if (data.startsWith("Websocket error")) {
          next(data, FALLBACK_MEMORY_USAGE);
          void scheduleReconnect();
          return;
        }

        try {
          const parsed = JSON.parse(data) as IMemoryUsageItem;
          next(null, parsed);
        } catch (error) {
          next(error, FALLBACK_MEMORY_USAGE);
        }
      },
    }),
  });

  return { response, refreshGetClashMemory: refresh };
};
