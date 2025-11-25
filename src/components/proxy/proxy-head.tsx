import {
  AccessTimeRounded,
  MyLocationRounded,
  NetworkCheckRounded,
  FilterAltRounded,
  FilterAltOffRounded,
  VisibilityRounded,
  VisibilityOffRounded,
  WifiTetheringRounded,
  WifiTetheringOffRounded,
  SortByAlphaRounded,
  SortRounded,
} from "@mui/icons-material";
import { Box, IconButton, TextField, SxProps } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useVerge } from "@/hooks/use-verge";
import delayManager from "@/services/delay";
import { debugLog } from "@/utils/debug";

import type { ProxySortType } from "./use-filter-sort";
import type { HeadState } from "./use-head-state";

interface Props {
  sx?: SxProps;
  url?: string;
  groupName: string;
  headState: HeadState;
  onLocation: () => void;
  onCheckDelay: () => void;
  onHeadState: (val: Partial<HeadState>) => void;
}

const defaultSx: SxProps = {};

export const ProxyHead = ({
  sx = defaultSx,
  url,
  groupName,
  headState,
  onHeadState,
  onLocation,
  onCheckDelay,
}: Props) => {
  const { showType, sortType, filterText, textState, testUrl } = headState;

  const { t } = useTranslation();
  const [autoFocus, setAutoFocus] = useState(false);

  useEffect(() => {
    // fix the focus conflict
    const timer = setTimeout(() => setAutoFocus(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const { verge } = useVerge();
  const defaultLatencyUrl =
    verge?.default_latency_test?.trim() ||
    "https://cp.cloudflare.com/generate_204";

  useEffect(() => {
    delayManager.setUrl(groupName, testUrl?.trim() || url || defaultLatencyUrl);
  }, [groupName, testUrl, defaultLatencyUrl, url]);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ...sx }}>
      <IconButton
        size="small"
        color="inherit"
        title={t("proxies.page.tooltips.locate")}
        onClick={onLocation}
      >
        <MyLocationRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("proxies.page.tooltips.delayCheck")}
        onClick={() => {
          debugLog(`[ProxyHead] 点击延迟测试按钮，组: ${groupName}`);
          // Remind the user that it is custom test url
          if (testUrl?.trim() && textState !== "filter") {
            debugLog(`[ProxyHead] 使用自定义测试URL: ${testUrl}`);
            onHeadState({ textState: "url" });
          }
          onCheckDelay();
        }}
      >
        <NetworkCheckRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={
          [
            t("proxies.page.tooltips.sortDefault"),
            t("proxies.page.tooltips.sortDelay"),
            t("proxies.page.tooltips.sortName"),
          ][sortType]
        }
        onClick={() =>
          onHeadState({ sortType: ((sortType + 1) % 3) as ProxySortType })
        }
      >
        {sortType !== 1 && sortType !== 2 && <SortRounded />}
        {sortType === 1 && <AccessTimeRounded />}
        {sortType === 2 && <SortByAlphaRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("proxies.page.tooltips.delayCheckUrl")}
        onClick={() =>
          onHeadState({ textState: textState === "url" ? null : "url" })
        }
      >
        {textState === "url" ? (
          <WifiTetheringRounded />
        ) : (
          <WifiTetheringOffRounded />
        )}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={
          showType
            ? t("proxies.page.tooltips.showBasic")
            : t("proxies.page.tooltips.showDetail")
        }
        onClick={() => onHeadState({ showType: !showType })}
      >
        {showType ? <VisibilityRounded /> : <VisibilityOffRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("proxies.page.tooltips.filter")}
        onClick={() =>
          onHeadState({ textState: textState === "filter" ? null : "filter" })
        }
      >
        {textState === "filter" ? (
          <FilterAltRounded />
        ) : (
          <FilterAltOffRounded />
        )}
      </IconButton>

      {textState === "filter" && (
        <TextField
          autoComplete="new-password"
          autoFocus={autoFocus}
          hiddenLabel
          value={filterText}
          size="small"
          variant="outlined"
          placeholder={t("shared.placeholders.filter")}
          onChange={(e) => onHeadState({ filterText: e.target.value })}
          sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
        />
      )}

      {textState === "url" && (
        <TextField
          autoComplete="new-password"
          autoFocus={autoFocus}
          hiddenLabel
          autoSave="off"
          value={testUrl}
          size="small"
          variant="outlined"
          placeholder={t("proxies.page.placeholders.delayCheckUrl")}
          onChange={(e) => onHeadState({ testUrl: e.target.value })}
          sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
        />
      )}
    </Box>
  );
};
