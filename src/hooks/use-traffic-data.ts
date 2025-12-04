import { MihomoWebSocket, Traffic } from "tauri-plugin-mihomo-api";

import { useMihomoWsSubscription } from "./use-mihomo-ws-subscription";
import { useTrafficMonitorEnhanced } from "./use-traffic-monitor";

const FALLBACK_TRAFFIC: Traffic = { up: 0, down: 0 };

export const useTrafficData = () => {
  const {
    graphData: { appendData },
  } = useTrafficMonitorEnhanced({ subscribe: false });
  const { response, refresh } = useMihomoWsSubscription<ITrafficItem>({
    storageKey: "mihomo_traffic_date",
    buildSubscriptKey: (date) => `getClashTraffic-${date}`,
    fallbackData: FALLBACK_TRAFFIC,
    connect: () => MihomoWebSocket.connect_traffic(),
    setupHandlers: ({ next, scheduleReconnect }) => ({
      handleMessage: (data) => {
        if (data.startsWith("Websocket error")) {
          next(data, FALLBACK_TRAFFIC);
          void scheduleReconnect();
          return;
        }

        try {
          const parsed = JSON.parse(data) as Traffic;
          appendData(parsed);
          next(null, parsed);
        } catch (error) {
          next(error, FALLBACK_TRAFFIC);
        }
      },
    }),
  });

  return { response, refreshGetClashTraffic: refresh };
};
