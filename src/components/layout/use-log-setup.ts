import dayjs from "dayjs";
import { useEffect } from "react";
import { useSetRecoilState } from "recoil";
import { listen } from "@tauri-apps/api/event";
import { ApiType } from "../../services/types";
import { getInfomation } from "../../services/api";
import { atomLogData } from "../../services/states";

const MAX_LOG_NUM = 1000;

// setup the log websocket
export default function useLogSetup() {
  const setLogData = useSetRecoilState(atomLogData);

  useEffect(() => {
    let ws: WebSocket = null!;
    let unlisten: () => void = null!;

    const handler = (event: MessageEvent<any>) => {
      const data = JSON.parse(event.data) as ApiType.LogItem;
      const time = dayjs().format("MM-DD HH:mm:ss");
      setLogData((l) => {
        if (l.length >= MAX_LOG_NUM) l.shift();
        return [...l, { ...data, time }];
      });
    };

    (async () => {
      const { server = "", secret = "" } = await getInfomation();

      ws = new WebSocket(`ws://${server}/logs?token=${secret}`);
      ws.addEventListener("message", handler);

      // reconnect the websocket
      unlisten = await listen("restart_clash", async () => {
        const { server = "", secret = "" } = await getInfomation();

        ws?.close();
        ws = new WebSocket(`ws://${server}/logs?token=${secret}`);
        ws.addEventListener("message", handler);
      });
    })();

    return () => {
      ws?.close();
      unlisten?.();
    };
  }, []);
}
