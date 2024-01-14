import { useRef } from "react";
import WebSocket from "tauri-plugin-websocket-api";
export type WsMsgFn = (event: string) => void;

export interface WsOptions {
  errorCount?: number; // default is 5
  onError?: (e: any) => void;
}

export const useWebsocket = (onMessage: WsMsgFn, options?: WsOptions) => {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<any>(null);

  const disconnect = async () => {
    if (wsRef.current) {
      await wsRef.current.disconnect();
      wsRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const connect = async (url: string) => {
    let errorCount = options?.errorCount ?? 5;
    if (!url) return;
    const connectHelper = async () => {
      await disconnect();
      const ws = await WebSocket.connect(url);

      ws.addListener((event) => {
        switch (event.type) {
          case "Text": {
            onMessage(event.data);
            break;
          }
          default: {
            break;
          }
        }
      });
      wsRef.current = ws;
    };
    try {
      await connectHelper();
    } catch (e) {
      errorCount -= 1;
      if (errorCount >= 0) {
        timerRef.current = setTimeout(connectHelper, 2500);
      } else {
        await disconnect();
        options?.onError?.(e);
      }
    }
  };

  return { connect, disconnect };
};
