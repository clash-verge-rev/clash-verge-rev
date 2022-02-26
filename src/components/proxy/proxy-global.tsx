import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useLockFn } from "ahooks";
import { Virtuoso } from "react-virtuoso";
import { Box, IconButton, TextField } from "@mui/material";
import {
  MyLocationRounded,
  NetworkCheckRounded,
  FilterAltRounded,
  FilterAltOffRounded,
  VisibilityRounded,
  VisibilityOffRounded,
} from "@mui/icons-material";
import { ApiType } from "../../services/types";
import { updateProxy } from "../../services/api";
import delayManager from "../../services/delay";
import useFilterProxy from "./use-filter-proxy";
import ProxyItem from "./proxy-item";

interface Props {
  groupName: string;
  curProxy?: string;
  proxies: ApiType.ProxyItem[];
}

const ProxyGlobal = (props: Props) => {
  const { groupName, curProxy, proxies } = props;

  const { mutate } = useSWRConfig();
  const [now, setNow] = useState(curProxy || "DIRECT");
  const [showType, setShowType] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [filterText, setFilterText] = useState("");

  const virtuosoRef = useRef<any>();
  const filterProxies = useFilterProxy(proxies, groupName, filterText);

  const onChangeProxy = useLockFn(async (name: string) => {
    await updateProxy("GLOBAL", name);
    mutate("getProxies");
    setNow(name);
  });

  const onLocation = (smooth = true) => {
    const index = filterProxies.findIndex((p) => p.name === now);

    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex?.({
        index,
        align: "center",
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  const onCheckAll = useLockFn(async () => {
    const names = filterProxies.map((p) => p.name);

    await delayManager.checkListDelay(
      { names, groupName, skipNum: 8, maxTimeout: 600 },
      () => mutate("getProxies")
    );

    mutate("getProxies");
  });

  useEffect(() => onLocation(false), [groupName]);

  useEffect(() => {
    if (!showFilter) setFilterText("");
  }, [showFilter]);

  useEffect(() => {
    if (groupName === "DIRECT") setNow("DIRECT");
    if (groupName === "GLOBAL") setNow(curProxy || "DIRECT");
  }, [groupName, curProxy]);

  return (
    <>
      <Box
        sx={{
          px: 3,
          my: 0.5,
          display: "flex",
          alignItems: "center",
          button: { mr: 0.5 },
        }}
      >
        <IconButton
          size="small"
          title="location"
          onClick={() => onLocation(true)}
        >
          <MyLocationRounded />
        </IconButton>

        <IconButton size="small" title="check" onClick={onCheckAll}>
          <NetworkCheckRounded />
        </IconButton>

        <IconButton
          size="small"
          title="check"
          onClick={() => setShowType(!showType)}
        >
          {showType ? <VisibilityRounded /> : <VisibilityOffRounded />}
        </IconButton>

        <IconButton
          size="small"
          title="check"
          onClick={() => setShowFilter(!showFilter)}
        >
          {showFilter ? <FilterAltRounded /> : <FilterAltOffRounded />}
        </IconButton>

        {showFilter && (
          <TextField
            autoFocus
            hiddenLabel
            value={filterText}
            size="small"
            variant="outlined"
            placeholder="Filter conditions"
            onChange={(e) => setFilterText(e.target.value)}
            sx={{ ml: 0.5, flex: "1 1 auto", input: { py: 0.65, px: 1 } }}
          />
        )}
      </Box>

      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "calc(100% - 40px)" }}
        totalCount={filterProxies.length}
        itemContent={(index) => (
          <ProxyItem
            groupName={groupName}
            proxy={filterProxies[index]}
            selected={filterProxies[index].name === now}
            showType={showType}
            onClick={onChangeProxy}
            sx={{ py: 0, px: 2 }}
          />
        )}
      />
    </>
  );
};

export default ProxyGlobal;
