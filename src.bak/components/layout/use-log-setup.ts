import dayjs from "dayjs";
import { useEffect } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { getClashLogs } from "@/services/cmds";
import { useClashInfo } from "@/hooks/use-clash";
import { atomEnableLog, atomLogData } from "@/services/states";
import { useWebsocket } from "@/hooks/use-websocket";

const MAX_LOG_NUM = 1000;

// setup the log websocket
export const useLogSetup = () => {
  const { clashInfo } = useClashInfo();

  const enableLog = useRecoilValue(atomEnableLog);
  const setLogData = useSetRecoilState(atomLogData);

  const { connect, disconnect } = useWebsocket((event) => {
    const data = JSON.parse(event.data) as ILogItem;
    const time = dayjs().format("MM-DD HH:mm:ss");
    setLogData((l) => {
      if (l.length >= MAX_LOG_NUM) l.shift();
      return [...l, { ...data, time }];
    });
  });

  useEffect(() => {
    if (!enableLog || !clashInfo) return;

    getClashLogs().then(setLogData);

    const { server = "", secret = "" } = clashInfo;
    connect(`ws://${server}/logs?token=${encodeURIComponent(secret)}`);

    return () => {
      disconnect();
    };
  }, [clashInfo, enableLog]);
};
