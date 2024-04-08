import { useRef } from "react";

export type WsMsgFn = (event: MessageEvent<any>) => void;

export interface WsOptions {
  errorCount?: number; // default is 5
  retryInterval?: number; // default is 2500
  onError?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
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

    if (!url) return;

    const connectHelper = () => {
      disconnect();

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("message", (event) => {
        errorCount = 0; // reset counter
        onMessage(event);
      });
      ws.addEventListener("error", (event) => {
        errorCount -= 1;

        if (errorCount >= 0) {
          timerRef.current = setTimeout(connectHelper, 2500);
        } else {
          disconnect();
          options?.onError?.(event);
        }
      });
      ws.addEventListener("close", (event) => {
        options?.onClose?.(event);
      });
    };

    connectHelper();
  };

  return { connect, disconnect };
};
