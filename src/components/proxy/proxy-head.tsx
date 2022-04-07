import { useState } from "react";
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
import type { ProxySortType } from "./use-filter-proxy";

interface Props {
  sx?: SxProps;
  showType: boolean;
  sortType: ProxySortType;
  urlText: string;
  filterText: string;
  onLocation: () => void;
  onCheckDelay: () => void;
  onShowType: (val: boolean) => void;
  onSortType: (val: ProxySortType) => void;
  onUrlText: (val: string) => void;
  onFilterText: (val: string) => void;
}

const ProxyHead = (props: Props) => {
  const { sx = {}, showType, sortType, urlText, filterText } = props;

  const [textState, setTextState] = useState<"url" | "filter" | null>(null);

  return (
    <Box sx={{ display: "flex", alignItems: "center", ...sx }}>
      <IconButton
        size="small"
        title="location"
        color="inherit"
        onClick={props.onLocation}
      >
        <MyLocationRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title="delay check"
        onClick={props.onCheckDelay}
      >
        <NetworkCheckRounded />
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title={["sort by default", "sort by name", "sort by delay"][sortType]}
        onClick={() => props.onSortType(((sortType + 1) % 3) as ProxySortType)}
      >
        {sortType === 0 && <SortRounded />}
        {sortType === 1 && <SortByAlphaRounded />}
        {sortType === 2 && <AccessTimeRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title="edit test url"
        onClick={() => setTextState((ts) => (ts === "url" ? null : "url"))}
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
        title="proxy detail"
        onClick={() => props.onShowType(!showType)}
      >
        {showType ? <VisibilityRounded /> : <VisibilityOffRounded />}
      </IconButton>

      <IconButton
        size="small"
        color="inherit"
        title="filter"
        onClick={() =>
          setTextState((ts) => (ts === "filter" ? null : "filter"))
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
          autoFocus
          hiddenLabel
          value={filterText}
          size="small"
          variant="outlined"
          placeholder="Filter conditions"
          onChange={(e) => props.onFilterText(e.target.value)}
          sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
        />
      )}

      {textState === "url" && (
        <TextField
          autoFocus
          hiddenLabel
          value={urlText}
          size="small"
          variant="outlined"
          placeholder="Test url"
          onChange={(e) => props.onUrlText(e.target.value)}
          sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
        />
      )}
    </Box>
  );
};

export default ProxyHead;
