import { useRef } from "react";

export type WsMsgFn = (event: MessageEvent<any>) => void;

export interface WsOptions {
  errorCount?: number; // default is 5
  retryInterval?: number; // default is 2500
  // keepConnect?: boolean; // default is false
  onError?: () => void;
}

export const useWebsocket = (onMessage: WsMsgFn, options?: WsOptions) => {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<any>(null);
  const manualDisConnRef = useRef<boolean>(false);
  const keepConnTimerRef = useRef<any>(null);

  const disconnect = (keepConnect: boolean = false) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (!keepConnect && keepConnTimerRef.current) {
      clearTimeout(keepConnTimerRef.current);
    }
    manualDisConnRef.current = true;
  };

  const connect = (url: string, reconnect: boolean = false) => {
    if (!url) return;

    let errorCount = options?.errorCount ?? 5;
    const retryInterval = options?.retryInterval ?? 2500;
    let successConnected = false;

    const connectHelper = () => {
      if (!reconnect) {
        disconnect();
      }

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        successConnected = true;
        manualDisConnRef.current = false;
      });
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", () => {
        if (reconnect) {
          if (successConnected && !manualDisConnRef.current) {
            keepConnTimerRef.current = setTimeout(connectHelper, 2000);
          }
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
