import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, TextField, SxProps } from "@mui/material";
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
import delayManager from "@/services/delay";
import type { HeadState } from "./use-head-state";
import type { ProxySortType } from "./use-sort-proxy";

interface Props {
  sx?: SxProps;
  groupName: string;
  headState: HeadState;
  onLocation: () => void;
  onCheckDelay: () => void;
  onHeadState: (val: Partial<HeadState>) => void;
}

const ProxyHead = (props: Props) => {
  const { sx = {}, groupName, headState, onHeadState } = props;

  const { showType, sortType, filterText, textState, testUrl } = headState;

  const { t } = useTranslation();
  const [autoFocus, setAutoFocus] = useState(false);

  useEffect(() => {
    // fix the focus conflict
    const timer = setTimeout(() => setAutoFocus(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    delayManager.setUrl(groupName, testUrl);
  }, [groupName, headState.testUrl]);

  return (
    <Box sx={{ display: "flex", alignItems: "center", ...sx }}>
      <IconButton
        size="small"
        color="inherit"
        title={t("Location")}
        onClick={props.onLocation}
      >
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
        }}
      >
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
        }
      >
        {sortType === 0 && <SortRounded />}
        {sortType === 1 && <AccessTimeRounded />}
        {sortType === 2 && <SortByAlphaRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("Delay check URL")}
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
        title={t("Proxy detail")}
        onClick={() => onHeadState({ showType: !showType })}
      >
        {showType ? <VisibilityRounded /> : <VisibilityOffRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={t("Filter")}
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
          autoFocus={autoFocus}
          hiddenLabel
          value={filterText}
          size="small"
          variant="outlined"
          placeholder={t("Filter conditions")}
          onChange={(e) => onHeadState({ filterText: e.target.value })}
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

export default ProxyHead;
