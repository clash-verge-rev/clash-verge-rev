import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useLockFn } from "ahooks";
import { Virtuoso } from "react-virtuoso";
import { Box, IconButton } from "@mui/material";
import { MyLocationRounded, NetworkCheckRounded } from "@mui/icons-material";
import { ApiType } from "../../services/types";
import { updateProxy } from "../../services/api";
import delayManager from "../../services/delay";
import ProxyItem from "./proxy-item";

interface Props {
  groupName: string;
  curProxy?: string;
  proxies: ApiType.ProxyItem[];
}

const ProxyGlobal = (props: Props) => {
  const { groupName, curProxy, proxies } = props;

  const { mutate } = useSWRConfig();
  const virtuosoRef = useRef<any>();
  const [now, setNow] = useState(curProxy || "DIRECT");

  const onChangeProxy = useLockFn(async (name: string) => {
    await updateProxy("GLOBAL", name);
    mutate("getProxies");
    setNow(name);
  });

  const onLocation = (smooth = true) => {
    const index = proxies.findIndex((p) => p.name === now);

    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex?.({
        index,
        align: "center",
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  const onCheckAll = useLockFn(async () => {
    // rerender quickly
    if (proxies.length) setTimeout(() => mutate("getProxies"), 500);

    let names = proxies.map((p) => p.name);
    while (names.length) {
      const list = names.slice(0, 8);
      names = names.slice(8);

      await Promise.all(list.map((n) => delayManager.checkDelay(n, groupName)));

      mutate("getProxies");
    }
  });

  useEffect(() => onLocation(false), [groupName]);

  useEffect(() => {
    if (groupName === "DIRECT") setNow("DIRECT");
    if (groupName === "GLOBAL") setNow(curProxy || "DIRECT");
  }, [groupName, curProxy]);

  return (
    <>
      <Box sx={{ px: 3, my: 0.5 }}>
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
      </Box>

      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "calc(100% - 40px)" }}
        totalCount={proxies.length}
        itemContent={(index) => (
          <ProxyItem
            groupName={groupName}
            proxy={proxies[index]}
            selected={proxies[index].name === now}
            onClick={onChangeProxy}
            sx={{ py: 0, px: 2 }}
          />
        )}
      />
    </>
  );
};

export default ProxyGlobal;
