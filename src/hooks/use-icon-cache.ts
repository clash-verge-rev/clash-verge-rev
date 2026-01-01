import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import useSWR from "swr";

import { downloadIconCache } from "@/services/cmds";
import { SWR_DEFAULTS } from "@/services/config";

export interface UseIconCacheOptions {
  icon?: string | null;
  cacheKey?: string;
  enabled?: boolean;
}

const getFileNameFromUrl = (url: string) => {
  const lastSlashIndex = url.lastIndexOf("/");
  return lastSlashIndex >= 0 ? url.slice(lastSlashIndex + 1) : url;
};

export const useIconCache = ({
  icon,
  cacheKey,
  enabled = true,
}: UseIconCacheOptions) => {
  const iconValue = icon?.trim() ?? "";
  const cacheKeyValue = cacheKey?.trim() ?? "";

  const swrKey = useMemo(() => {
    if (!enabled || !iconValue.startsWith("http") || cacheKeyValue === "") {
      return null;
    }

    return ["icon-cache", iconValue, cacheKeyValue] as const;
  }, [enabled, iconValue, cacheKeyValue]);

  const { data } = useSWR(
    swrKey,
    async () => {
      try {
        const fileName = `${cacheKeyValue}-${getFileNameFromUrl(iconValue)}`;
        const iconPath = await downloadIconCache(iconValue, fileName);
        return convertFileSrc(iconPath);
      } catch {
        return "";
      }
    },
    SWR_DEFAULTS,
  );

  if (!swrKey) {
    return "";
  }

  return data ?? "";
};
