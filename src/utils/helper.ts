import { debugLog } from "@/utils/debug";

export const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    debugLog(e);
    return false;
  }
};
