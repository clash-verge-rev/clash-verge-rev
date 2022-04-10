import useSWR, { useSWRConfig } from "swr";
import { useEffect, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { Virtuoso } from "react-virtuoso";
import {
  Box,
  Collapse,
  Divider,
  List,
  ListItem,
  ListItemText,
} from "@mui/material";
import {
  SendRounded,
  ExpandLessRounded,
  ExpandMoreRounded,
} from "@mui/icons-material";
import { ApiType } from "../../services/types";
import { updateProxy } from "../../services/api";
import { getProfiles, patchProfile } from "../../services/cmds";
import useSortProxy, { ProxySortType } from "./use-sort-proxy";
import useFilterProxy from "./use-filter-proxy";
import delayManager from "../../services/delay";
import ProxyHead from "./proxy-head";
import ProxyItem from "./proxy-item";

interface Props {
  group: ApiType.ProxyGroupItem;
}

const ProxyGroup = ({ group }: Props) => {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(group.now);

  const [showType, setShowType] = useState(false);
  const [sortType, setSortType] = useState<ProxySortType>(0);
  const [filterText, setFilterText] = useState("");

  const virtuosoRef = useRef<any>();
  const filterProxies = useFilterProxy(group.all, group.name, filterText);
  const sortedProxies = useSortProxy(filterProxies, group.name, sortType);

  const { data: profiles } = useSWR("getProfiles", getProfiles);

  const onChangeProxy = useLockFn(async (name: string) => {
    // Todo: support another proxy group type
    if (group.type !== "Selector") return;

    const oldValue = now;
    try {
      setNow(name);
      await updateProxy(group.name, name);
    } catch {
      setNow(oldValue);
      return; // do not update profile
    }

    try {
      const profile = profiles?.items?.find((p) => p.uid === profiles.current);
      if (!profile) return;
      if (!profile.selected) profile.selected = [];

      const index = profile.selected.findIndex(
        (item) => item.name === group.name
      );

      if (index < 0) {
        profile.selected.push({ name: group.name, now: name });
      } else {
        profile.selected[index] = { name: group.name, now: name };
      }
      await patchProfile(profiles!.current!, { selected: profile.selected });
    } catch (err) {
      console.error(err);
    }
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
    const groupName = group.name;

    await delayManager.checkListDelay({ names, groupName, skipNum: 8 }, () =>
      mutate("getProxies")
    );
  });

  // auto scroll to current index
  useEffect(() => {
    if (open) {
      setTimeout(() => onLocation(false), 5);
    }
  }, [open]);

  return (
    <>
      <ListItem button onClick={() => setOpen(!open)} dense>
        <ListItemText
          primary={group.name}
          secondary={
            <>
              <SendRounded color="primary" sx={{ mr: 1, fontSize: 14 }} />
              <span>{now}</span>
            </>
          }
          secondaryTypographyProps={{
            sx: { display: "flex", alignItems: "center" },
          }}
        />

        {open ? <ExpandLessRounded /> : <ExpandMoreRounded />}
      </ListItem>

      <Collapse in={open} timeout="auto" unmountOnExit>
        <ProxyHead
          sx={{ pl: 4, pr: 3, my: 0.5, button: { mr: 0.5 } }}
          showType={showType}
          sortType={sortType}
          groupName={group.name}
          filterText={filterText}
          onLocation={onLocation}
          onCheckDelay={onCheckAll}
          onShowType={setShowType}
          onSortType={setSortType}
          onFilterText={setFilterText}
        />

        {!sortedProxies.length && (
          <Box
            sx={{
              py: 3,
              fontSize: 18,
              textAlign: "center",
              color: "text.secondary",
            }}
          >
            Empty
          </Box>
        )}

        {sortedProxies.length >= 10 ? (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: "320px", marginBottom: "4px" }}
            totalCount={sortedProxies.length}
            itemContent={(index) => (
              <ProxyItem
                groupName={group.name}
                proxy={sortedProxies[index]}
                selected={sortedProxies[index].name === now}
                showType={showType}
                sx={{ py: 0, pl: 4 }}
                onClick={onChangeProxy}
              />
            )}
          />
        ) : (
          <List
            component="div"
            disablePadding
            sx={{ maxHeight: "320px", overflow: "auto", mb: "4px" }}
          >
            {sortedProxies.map((proxy) => (
              <ProxyItem
                key={proxy.name}
                groupName={group.name}
                proxy={proxy}
                selected={proxy.name === now}
                showType={showType}
                sx={{ py: 0, pl: 4 }}
                onClick={onChangeProxy}
              />
            ))}
          </List>
        )}

        <Divider variant="middle" />
      </Collapse>
    </>
  );
};

export default ProxyGroup;
