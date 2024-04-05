import { useRef } from "react";

export type WsMsgFn = (event: MessageEvent<any>) => void;

export interface WsOptions {
  errorCount?: number; // default is 5
  retryInterval?: number; // default is 2500
  keepConnect?: boolean; // default is false
  onError?: () => void;
}

export const useWebsocket = (onMessage: WsMsgFn, options?: WsOptions) => {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<any>(null);

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const connect = (url: string) => {
    let errorCount = options?.errorCount ?? 5;
    const retryInterval = options?.retryInterval ?? 2500;
    const autoConnect = options?.keepConnect ?? false;

    if (!url) return;

    const connectHelper = () => {
      disconnect();

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", () => {
        if (autoConnect) {
          setTimeout(connectHelper, 3000);
        }
      });
      ws.addEventListener("error", () => {
        errorCount -= 1;

        if (errorCount >= 0) {
          timerRef.current = setTimeout(connectHelper, retryInterval);
        } else {
          disconnect();
          options?.onError?.();
        }
      });
    };

    connectHelper();
  };

  return { connect, disconnect };
};
