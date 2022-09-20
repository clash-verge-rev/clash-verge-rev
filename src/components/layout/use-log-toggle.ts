import { useEffect } from "react";
import { useRecoilState } from "recoil";
import { atomEnableLog } from "@/services/states";

const LOG_KEY = "enable-log";

export default function useLogToggle() {
  const [enableLog, setEnableLog] = useRecoilState(atomEnableLog);

  useEffect(() => {
    try {
      setEnableLog(localStorage.getItem(LOG_KEY) !== "false");
    } catch {}
  }, []);

  const setter = (enable: boolean) => {
    try {
      localStorage.setItem(LOG_KEY, enable.toString());
    } catch {}
    setEnableLog(enable);
  };

  return [enableLog, setter];
}
