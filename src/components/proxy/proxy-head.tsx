import { useVerge } from "@/hooks/use-verge";
import delayManager from "@/services/delay";
import {
  AccessTimeRounded,
  FilterAltOffRounded,
  FilterAltRounded,
  MyLocationRounded,
  NetworkCheckRounded,
  SortByAlphaRounded,
  SortRounded,
  VisibilityOffRounded,
  VisibilityRounded,
  WifiTetheringOffRounded,
  WifiTetheringRounded,
} from "@mui/icons-material";
import { Box, IconButton, SxProps, TextField } from "@mui/material";
import debounce from "lodash-es/debounce";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProxySortType } from "./use-filter-sort";
import type { HeadState } from "./use-head-state";

interface Props {
  sx?: SxProps;
  groupName: string;
  headState: HeadState;
  onLocation: () => void;
  onCheckDelay: () => void;
  onHeadState: (val: Partial<HeadState>) => void;
}

export const ProxyHead = (props: Props) => {
  const { sx = {}, groupName, headState, onHeadState } = props;

  const { showType, sortType, filterText, textState, testUrl } = headState;
  const [filterTextInp, setFilterTextInp] = useState(filterText ?? "");

  const { t } = useTranslation();
  const [autoFocus, setAutoFocus] = useState(false);

  useEffect(() => {
    // fix the focus conflict
    const timer = setTimeout(() => setAutoFocus(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const { verge } = useVerge();

  useEffect(() => {
    delayManager.setUrl(groupName, testUrl || verge?.default_latency_test!);
  }, [groupName, testUrl, verge?.default_latency_test]);

  const filterChange = debounce((text: string) => {
    onHeadState({ filterText: text });
  }, 500);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ...sx }}>
      <IconButton
        size="small"
        color="inherit"
        title={t("Location")}
        onClick={props.onLocation}>
        <MyLocationRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("Delay check")}
        onClick={() => {
          // Remind the user that it is custom test url
          if (testUrl?.trim() && textState !== "filter") {
            onHeadState({ textState: "url" });
          }
          props.onCheckDelay();
        }}>
        <NetworkCheckRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={
          [t("Sort by default"), t("Sort by delay"), t("Sort by name")][
            sortType
          ]
        }
        onClick={() =>
          onHeadState({ sortType: ((sortType + 1) % 3) as ProxySortType })
        }>
        {sortType !== 1 && sortType !== 2 && <SortRounded />}
        {sortType === 1 && <AccessTimeRounded />}
        {sortType === 2 && <SortByAlphaRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("Delay check URL")}
        onClick={() =>
          onHeadState({ textState: textState === "url" ? null : "url" })
        }>
        {textState === "url" ? (
          <WifiTetheringRounded />
        ) : (
          <WifiTetheringOffRounded />
        )}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={showType ? t("Proxy basic") : t("Proxy detail")}
        onClick={() => onHeadState({ showType: !showType })}>
        {showType ? <VisibilityRounded /> : <VisibilityOffRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("Filter")}
        onClick={() => {
          setFilterTextInp("");
          onHeadState({
            textState: textState === "filter" ? null : "filter",
            filterText: "",
          });
        }}>
        {textState === "filter" ? (
          <FilterAltRounded />
        ) : (
          <FilterAltOffRounded />
        )}
      </IconButton>

      {textState === "filter" && (
        <TextField
          autoFocus={autoFocus}
          hiddenLabel
          value={filterTextInp}
          size="small"
          variant="outlined"
          placeholder={t("Filter conditions")}
          onChange={(e) => {
            const text = e.target.value;
            setFilterTextInp(text);
            filterChange(text);
          }}
          sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
        />
      )}

      {textState === "url" && (
        <TextField
          autoFocus={autoFocus}
          hiddenLabel
          autoSave="off"
          autoComplete="off"
          value={testUrl}
          size="small"
          variant="outlined"
          placeholder={t("Delay check URL")}
          onChange={(e) => onHeadState({ testUrl: e.target.value })}
          sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
        />
      )}
    </Box>
  );
};
