import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useLockFn } from "ahooks";
import { Virtuoso } from "react-virtuoso";
import {
  Box,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
} from "@mui/material";
import {
  SendRounded,
  ExpandLessRounded,
  ExpandMoreRounded,
  MyLocationRounded,
  NetworkCheckRounded,
} from "@mui/icons-material";
import { ApiType } from "../../services/types";
import { updateProxy } from "../../services/api";
import { getProfiles, patchProfile } from "../../services/cmds";
import delayManager from "../../services/delay";
import ProxyItem from "./proxy-item";

interface Props {
  group: ApiType.ProxyGroupItem;
}

const ProxyGroup = ({ group }: Props) => {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(group.now);

  const virtuosoRef = useRef<any>();
  const proxies = group.all ?? [];

  const onSelect = useLockFn(async (name: string) => {
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
      const profiles = await getProfiles();
      const profile = profiles.items![profiles.current!]!;
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
      await patchProfile(profiles.current!, profile);
    } catch (err) {
      console.error(err);
    }
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

      await Promise.all(
        list.map((n) => delayManager.checkDelay(n, group.name))
      );

      mutate("getProxies");
    }
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
        <Box sx={{ pl: 4, pr: 3, my: 0.5 }}>
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

        {proxies.length >= 10 ? (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: "320px", marginBottom: "4px" }}
            totalCount={proxies.length}
            itemContent={(index) => (
              <ProxyItem
                groupName={group.name}
                proxy={proxies[index]}
                selected={proxies[index].name === now}
                sx={{ py: 0, pl: 4 }}
                onClick={onSelect}
              />
            )}
          />
        ) : (
          <List
            component="div"
            disablePadding
            sx={{ maxHeight: "320px", overflow: "auto", mb: "4px" }}
          >
            {proxies.map((proxy) => (
              <ProxyItem
                key={proxy.name}
                groupName={group.name}
                proxy={proxy}
                selected={proxy.name === now}
                sx={{ py: 0, pl: 4 }}
                onClick={onSelect}
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
