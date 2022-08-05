import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useSetRecoilState } from "recoil";
import { listen } from "@tauri-apps/api/event";
import { getInformation } from "@/services/api";
import { atomLogData } from "@/services/states";

const MAX_LOG_NUM = 1000;

// setup the log websocket
export default function useLogSetup() {
  const [refresh, setRefresh] = useState({});
  const setLogData = useSetRecoilState(atomLogData);

  useEffect(() => {
    let ws: WebSocket = null!;

    const handler = (event: MessageEvent<any>) => {
      const data = JSON.parse(event.data) as ApiType.LogItem;
      const time = dayjs().format("MM-DD HH:mm:ss");
      setLogData((l) => {
        if (l.length >= MAX_LOG_NUM) l.shift();
        return [...l, { ...data, time }];
      });
    };

    getInformation().then((info) => {
      const { server = "", secret = "" } = info;
      ws = new WebSocket(`ws://${server}/logs?token=${secret}`);
      ws.addEventListener("message", handler);
    });

    const unlisten = listen("verge://refresh-clash-config", () =>
      setRefresh({})
    );

    return () => {
      ws?.close();
      unlisten?.then((fn) => fn());
    };
  }, [refresh]);
}
