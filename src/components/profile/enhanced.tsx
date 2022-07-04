import useSWR from "swr";
import { useState } from "react";
import { useLockFn } from "ahooks";
import {
  Box,
  Divider,
  Grid,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
} from "@mui/material";
import {
  AddchartRounded,
  CheckRounded,
  MenuRounded,
  RestartAltRounded,
} from "@mui/icons-material";
import {
  getProfiles,
  deleteProfile,
  enhanceProfiles,
  changeProfileChain,
  changeProfileValid,
} from "../../services/cmds";
import { CmdType } from "../../services/types";
import ProfileMore from "./profile-more";
import Notice from "../base/base-notice";

interface Props {
  items: CmdType.ProfileItem[];
  chain: string[];
}

const EnhancedMode = (props: Props) => {
  const { items, chain } = props;

  const { data, mutate } = useSWR("getProfiles", getProfiles);
  const valid = data?.valid || [];

  const [anchorEl, setAnchorEl] = useState<any>(null);

  // handler
  const onEnhance = useLockFn(async () => {
    try {
      await enhanceProfiles();
      Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  const onEnhanceEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;

    const newChain = [...chain, uid];
    await changeProfileChain(newChain);
    mutate((conf = {}) => ({ ...conf, chain: newChain }), true);
  });

  const onEnhanceDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid);
    await changeProfileChain(newChain);
    mutate((conf = {}) => ({ ...conf, chain: newChain }), true);
  });

  const onEnhanceDelete = useLockFn(async (uid: string) => {
    try {
      await onEnhanceDisable(uid);
      await deleteProfile(uid);
      mutate();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onMoveTop = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = [uid].concat(chain.filter((i) => i !== uid));
    await changeProfileChain(newChain);
    mutate((conf = {}) => ({ ...conf, chain: newChain }), true);
  });

  const onMoveEnd = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid).concat([uid]);
    await changeProfileChain(newChain);
    mutate((conf = {}) => ({ ...conf, chain: newChain }), true);
  });

  // update valid list
  const onToggleValid = useLockFn(async (key: string) => {
    try {
      const newValid = valid.includes(key)
        ? valid.filter((i) => i !== key)
        : valid.concat(key);
      await changeProfileValid(newValid);
      mutate();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Box sx={{ mt: 4 }}>
      <Stack
        spacing={1}
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        sx={{ mb: 0.5 }}
      >
        <IconButton
          size="small"
          color="inherit"
          title="refresh enhanced profiles"
          onClick={onEnhance}
        >
          <RestartAltRounded />
        </IconButton>

        <IconButton
          size="small"
          color="inherit"
          id="profile-use-button"
          title="enable clash fields"
          aria-controls={!!anchorEl ? "profile-use-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={!!anchorEl ? "true" : undefined}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          <MenuRounded />
        </IconButton>

        <Menu
          id="profile-use-menu"
          open={!!anchorEl}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          transitionDuration={225}
          MenuListProps={{
            dense: true,
            "aria-labelledby": "profile-use-button",
          }}
          onContextMenu={(e) => {
            setAnchorEl(null);
            e.preventDefault();
          }}
        >
          <MenuItem>
            <ListItemIcon color="inherit">
              <AddchartRounded />
            </ListItemIcon>
            Use Clash Fields
          </MenuItem>

          <Divider />

          {[
            "tun",
            "dns",
            "hosts",
            "script",
            "profile",
            "payload",
            "interface-name",
            "routing-mark",
          ].map((key) => {
            const has = valid.includes(key);

            return (
              <MenuItem
                key={key}
                sx={{ width: 180 }}
                onClick={() => onToggleValid(key)}
              >
                {has && (
                  <ListItemIcon color="inherit">
                    <CheckRounded />
                  </ListItemIcon>
                )}
                <ListItemText inset={!has}>{key}</ListItemText>
              </MenuItem>
            );
          })}
        </Menu>
      </Stack>

      <Grid container spacing={2}>
        {items.map((item) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileMore
              selected={!!chain.includes(item.uid)}
              itemData={item}
              enableNum={chain.length}
              onEnable={() => onEnhanceEnable(item.uid)}
              onDisable={() => onEnhanceDisable(item.uid)}
              onDelete={() => onEnhanceDelete(item.uid)}
              onMoveTop={() => onMoveTop(item.uid)}
              onMoveEnd={() => onMoveEnd(item.uid)}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default EnhancedMode;
