import { useLocalStorage } from "foxact/use-local-storage";
import { useCallback, useEffect, useRef } from "react";
import { mutate, type MutatorCallback } from "swr";
import useSWRSubscription from "swr/subscription";
import { type Message, type MihomoWebSocket } from "tauri-plugin-mihomo-api";

export const RECONNECT_DELAY_MS = 500;

type NextFn<T> = (error?: any, data?: T | MutatorCallback<T>) => void;

interface HandlerContext<T> {
  next: NextFn<T>;
  scheduleReconnect: () => Promise<void>;
  isMounted: () => boolean;
}

interface HandlerResult {
  handleMessage: (data: string) => void;
  onConnected?: (ws: MihomoWebSocket) => Promise<void> | void;
  cleanup?: () => void;
}

interface UseMihomoWsSubscriptionOptions<T> {
  storageKey: string;
  buildSubscriptKey: (date: number) => string | null;
  fallbackData: T;
  connect: () => Promise<MihomoWebSocket>;
  keepPreviousData?: boolean;
  setupHandlers: (ctx: HandlerContext<T>) => HandlerResult;
}

export const useMihomoWsSubscription = <T>(
  options: UseMihomoWsSubscriptionOptions<T>,
) => {
  const {
    storageKey,
    buildSubscriptKey,
    fallbackData,
    connect,
    keepPreviousData = true,
    setupHandlers,
  } = options;

  const [date, setDate] = useLocalStorage(storageKey, Date.now());
  const subscriptKey = buildSubscriptKey(date);
  const subscriptionCacheKey = subscriptKey ? `$sub$${subscriptKey}` : null;

  const wsRef = useRef<MihomoWebSocket | null>(null);
  const wsFirstConnection = useRef<boolean>(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const response = useSWRSubscription<T, any, string | null>(
    subscriptKey,
    (_key, { next }) => {
      let isMounted = true;

      const clearReconnectTimer = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };

      const closeSocket = async () => {
        if (wsRef.current) {
          await wsRef.current.close();
          wsRef.current = null;
        }
      };

      const scheduleReconnect = async () => {
        if (!isMounted) return;
        clearReconnectTimer();
        await closeSocket();
        if (!isMounted) return;
        timeoutRef.current = setTimeout(connectWs, RECONNECT_DELAY_MS);
      };

      const {
        handleMessage: handleTextMessage,
        onConnected,
        cleanup,
      } = setupHandlers({
        next,
        scheduleReconnect,
        isMounted: () => isMounted,
      });

      const cleanupAll = () => {
        clearReconnectTimer();
        cleanup?.();
        void closeSocket();
      };

      const handleMessage = (msg: Message) => {
        if (msg.type !== "Text") return;
        handleTextMessage(msg.data);
      };

      async function connectWs() {
        try {
          const ws_ = await connect();
          if (!isMounted) {
            await ws_.close();
            return;
          }

          wsRef.current = ws_;
          clearReconnectTimer();

          if (onConnected) {
            await onConnected(ws_);
            if (!isMounted) {
              await ws_.close();
              return;
            }
          }

          ws_.addListener(handleMessage);
        } catch (ignoreError) {
          if (!wsRef.current && isMounted) {
            timeoutRef.current = setTimeout(connectWs, RECONNECT_DELAY_MS);
          }
        }
      }

      if (wsFirstConnection.current || !wsRef.current) {
        wsFirstConnection.current = false;
        cleanupAll();
        void connectWs();
      }

      return () => {
        isMounted = false;
        wsFirstConnection.current = true;
        cleanupAll();
      };
    },
    {
      fallbackData,
      keepPreviousData,
    },
  );

  useEffect(() => {
    if (subscriptionCacheKey) {
      mutate(subscriptionCacheKey);
    }
  }, [subscriptionCacheKey]);

  const refresh = useCallback(() => {
    setDate(Date.now());
  }, [setDate]);

  return { response, refresh, subscriptionCacheKey, wsRef };
};
