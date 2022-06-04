import useSWR, { useSWRConfig } from "swr";
import { useEffect, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { Virtuoso } from "react-virtuoso";
import { ApiType } from "../../services/types";
import { updateProxy } from "../../services/api";
import { getProfiles, patchProfile } from "../../services/cmds";
import useSortProxy from "./use-sort-proxy";
import useHeadState from "./use-head-state";
import useFilterProxy from "./use-filter-proxy";
import delayManager from "../../services/delay";
import ProxyHead from "./proxy-head";
import ProxyItem from "./proxy-item";

interface Props {
  groupName: string;
  curProxy?: string;
  proxies: ApiType.ProxyItem[];
}

// this component will be used for DIRECT/GLOBAL
const ProxyGlobal = (props: Props) => {
  const { groupName, curProxy, proxies } = props;

  const { mutate } = useSWRConfig();
  const [now, setNow] = useState(curProxy || "DIRECT");

  const [headState, setHeadState] = useHeadState(groupName);

  const virtuosoRef = useRef<any>();
  const filterProxies = useFilterProxy(
    proxies,
    groupName,
    headState.filterText
  );
  const sortedProxies = useSortProxy(
    filterProxies,
    groupName,
    headState.sortType
  );

  const { data: profiles } = useSWR("getProfiles", getProfiles);

  const onChangeProxy = useLockFn(async (name: string) => {
    await updateProxy(groupName, name);
    setNow(name);

    if (groupName === "DIRECT") return;

    // update global selected
    const profile = profiles?.items?.find((p) => p.uid === profiles.current);
    if (!profile) return;
    if (!profile.selected) profile.selected = [];

    const index = profile.selected.findIndex((item) => item.name === groupName);
    if (index < 0) {
      profile.selected.unshift({ name: groupName, now: name });
    } else {
      profile.selected[index] = { name: groupName, now: name };
    }

    await patchProfile(profiles!.current!, { selected: profile.selected });
  });

  const onLocation = (smooth = true) => {
    const index = sortedProxies.findIndex((p) => p.name === now);

    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex?.({
        index,
        align: "center",
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  const onCheckAll = useLockFn(async () => {
    const names = sortedProxies.map((p) => p.name);

    await delayManager.checkListDelay({ names, groupName, skipNum: 8 }, () =>
      mutate("getProxies")
    );
  });

  useEffect(() => onLocation(false), [groupName]);

  useEffect(() => {
    if (groupName === "DIRECT") setNow("DIRECT");
    else if (groupName === "GLOBAL") {
      if (profiles) {
        const current = profiles.current;
        const profile = profiles.items?.find((p) => p.uid === current);

        profile?.selected?.forEach((item) => {
          if (item.name === "GLOBAL") {
            if (item.now && item.now !== curProxy) {
              updateProxy("GLOBAL", item.now).then(() => setNow(item!.now!));
              mutate("getProxies");
            }
          }
        });
      }

      setNow(curProxy || "DIRECT");
    }
  }, [groupName, curProxy, profiles]);

  return (
    <>
      <ProxyHead
        sx={{ px: 3, my: 0.5, button: { mr: 0.5 } }}
        groupName={groupName}
        headState={headState}
        onLocation={onLocation}
        onCheckDelay={onCheckAll}
        onHeadState={setHeadState}
      />

      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "calc(100% - 40px)" }}
        totalCount={sortedProxies.length}
        itemContent={(index) => (
          <ProxyItem
            groupName={groupName}
            proxy={sortedProxies[index]}
            selected={sortedProxies[index].name === now}
            showType={headState.showType}
            onClick={onChangeProxy}
            sx={{ py: 0, px: 2 }}
          />
        )}
      />
    </>
  );
};

export default ProxyGlobal;
