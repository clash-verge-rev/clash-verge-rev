import { useRef, useState } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
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
import ProxyItem from "./proxy-item";

interface Props {
  group: ApiType.ProxyGroupItem;
}

const ProxyGroup = ({ group }: Props) => {
  const listRef = useRef<any>();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(group.now);

  const proxies = group.all ?? [];

  const onUpdate = async (name: string) => {
    // can not call update
    if (group.type !== "Selector") {
      // Todo
      // error Tips
      return;
    }
    const oldValue = now;
    try {
      setNow(name);
      await updateProxy(group.name, name);

      const profiles = await getProfiles().catch(console.error);
      if (!profiles) return;
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

      patchProfile(profiles.current!, profile).catch(console.error);
    } catch {
      setNow(oldValue);
      // Todo
      // error tips
    }
  };

  const onLocation = () => {
    const index = proxies.findIndex((p) => p.name === now);

    if (index >= 0) {
      listRef.current?.scrollToIndex?.({
        index,
        align: "center",
        behavior: "smooth",
      });
    }
  };

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
          <IconButton size="small" title="location" onClick={onLocation}>
            <MyLocationRounded />
          </IconButton>
          <IconButton size="small" title="check">
            <NetworkCheckRounded />
          </IconButton>
        </Box>

        {proxies.length >= 10 ? (
          <Virtuoso
            ref={listRef}
            style={{ height: "320px", marginBottom: "4px" }}
            totalCount={proxies.length}
            itemContent={(index) => (
              <ProxyItem
                proxy={proxies[index]}
                selected={proxies[index].name === now}
                sx={{ py: 0, pl: 4 }}
                onClick={onUpdate}
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
                proxy={proxy}
                selected={proxy.name === now}
                sx={{ py: 0, pl: 4 }}
                onClick={onUpdate}
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
