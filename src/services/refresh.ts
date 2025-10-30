import { mutate } from "swr";

import { getAxios } from "@/services/api";

export const refreshClashData = async () => {
  try {
    await getAxios(true);
  } catch (error) {
    console.warn("[Refresh] getAxios failed during clash refresh:", error);
  }

  mutate("getProxies");
  mutate("getVersion");
  mutate("getClashConfig");
  mutate("getProxyProviders");
};

export const refreshVergeData = () => {
  mutate("getVergeConfig");
  mutate("getSystemProxy");
  mutate("getAutotemProxy");
  mutate("getRunningMode");
  mutate("isServiceAvailable");
};
