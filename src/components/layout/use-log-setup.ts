import dayjs from "dayjs";
import { useEffect } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { getClashLogs } from "@/services/cmds";
import { useClashInfo } from "@/hooks/use-clash";
import { atomEnableLog, atomLogData } from "@/services/states";

const MAX_LOG_NUM = 1000;

// setup the log websocket
export const useLogSetup = () => {
  const { clashInfo } = useClashInfo();

  const enableLog = useRecoilValue(atomEnableLog);
  const setLogData = useSetRecoilState(atomLogData);

  useEffect(() => {
    if (!enableLog || !clashInfo) return;

    getClashLogs().then(setLogData);

    const { server = "", secret = "" } = clashInfo;
    const ws = new WebSocket(`ws://${server}/logs?token=${secret}`);

    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data) as ILogItem;
      const time = dayjs().format("MM-DD HH:mm:ss");
      setLogData((l) => {
        if (l.length >= MAX_LOG_NUM) l.shift();
        return [...l, { ...data, time }];
      });
    });

    return () => ws?.close();
  }, [clashInfo, enableLog]);
};
