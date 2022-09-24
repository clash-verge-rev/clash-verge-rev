import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { listen } from "@tauri-apps/api/event";
import { getInformation } from "@/services/api";
import { getClashLogs } from "@/services/cmds";
import { atomEnableLog, atomLogData } from "@/services/states";

const MAX_LOG_NUM = 1000;

// setup the log websocket
export default function useLogSetup() {
  const [refresh, setRefresh] = useState({});

  const enableLog = useRecoilValue(atomEnableLog);
  const setLogData = useSetRecoilState(atomLogData);

  useEffect(() => {
    if (!enableLog) return;

    getClashLogs().then(setLogData);

    const handler = (event: MessageEvent<any>) => {
      const data = JSON.parse(event.data) as ApiType.LogItem;
      const time = dayjs().format("MM-DD HH:mm:ss");
      setLogData((l) => {
        if (l.length >= MAX_LOG_NUM) l.shift();
        return [...l, { ...data, time }];
      });
    };

    const ws = getInformation().then((info) => {
      const { server = "", secret = "" } = info;
      const ws = new WebSocket(`ws://${server}/logs?token=${secret}`);
      ws.addEventListener("message", handler);
      return ws;
    });

    const unlisten = listen("verge://refresh-clash-config", () =>
      setRefresh({})
    );

    return () => {
      ws.then((ws) => ws?.close());
      unlisten.then((fn) => fn());
    };
  }, [refresh, enableLog]);
}
