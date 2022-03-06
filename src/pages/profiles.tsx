import useSWR, { useSWRConfig } from "swr";
import { useLockFn } from "ahooks";
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Grid, TextField } from "@mui/material";
import {
  getProfiles,
  patchProfile,
  deleteProfile,
  selectProfile,
  importProfile,
  changeProfileChain,
} from "../services/cmds";
import { getProxies, updateProxy } from "../services/api";
import Notice from "../components/base/base-notice";
import BasePage from "../components/base/base-page";
import ProfileNew from "../components/profile/profile-new";
import ProfileItem from "../components/profile/profile-item";
import ProfileMore from "../components/profile/profile-more";

const ProfilePage = () => {
  const { mutate } = useSWRConfig();

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  const { regularItems, enhanceItems } = useMemo(() => {
    const items = profiles.items || [];
    const chain = profiles.chain || [];

    const type1 = ["local", "remote"];
    const type2 = ["merge", "script"];

    const regularItems = items.filter((i) => type1.includes(i.type!));
    const restItems = items.filter((i) => type2.includes(i.type!));

    const restMap = Object.fromEntries(restItems.map((i) => [i.uid, i]));

    const enhanceItems = chain
      .map((i) => restMap[i]!)
      .concat(restItems.filter((i) => !chain.includes(i.uid)));

    return { regularItems, enhanceItems };
  }, [profiles]);

  useEffect(() => {
    if (profiles.current == null) return;

    const current = profiles.current;
    const profile = regularItems.find((p) => p.uid === current);
    if (!profile) return;

    setTimeout(async () => {
      const proxiesData = await getProxies();
      mutate("getProxies", proxiesData);

      // init selected array
      const { selected = [] } = profile;
      const selectedMap = Object.fromEntries(
        selected.map((each) => [each.name!, each.now!])
      );

      // todo: enhance error handle
      let hasChange = false;
      proxiesData.groups.forEach((group) => {
        const { name, now } = group;

        if (!now || selectedMap[name] === now) return;
        if (selectedMap[name] == null) {
          selectedMap[name] = now!;
        } else {
          hasChange = true;
          updateProxy(name, selectedMap[name]);
        }
      });
      // update profile selected list
      profile.selected = Object.entries(selectedMap).map(([name, now]) => ({
        name,
        now,
      }));
      patchProfile(current!, profile).catch(console.error);
      // update proxies cache
      if (hasChange) mutate("getProxies", getProxies());
    }, 100);
  }, [profiles, regularItems]);

  const onImport = async () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);

    try {
      await importProfile(url);
      Notice.success("Successfully import profile.");

      getProfiles().then((newProfiles) => {
        mutate("getProfiles", newProfiles);

        if (!newProfiles.current && newProfiles.items?.length) {
          const current = newProfiles.items[0].uid;
          selectProfile(current);
          mutate("getProfiles", { ...newProfiles, current }, true);
        }
      });
    } catch {
      Notice.error("Failed to import profile.");
    } finally {
      setDisabled(false);
    }
  };

  const onSelect = useLockFn(async (uid: string, force: boolean) => {
    if (!force && uid === profiles.current) return;

    try {
      await selectProfile(uid);
      mutate("getProfiles", { ...profiles, current: uid }, true);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  /** enhanced profile mode */

  const chain = profiles.chain || [];

  const onEnhanceEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;

    const newChain = [...chain, uid];
    await changeProfileChain(newChain);
    mutate("getProfiles", { ...profiles, chain: newChain }, true);
  });

  const onEnhanceDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid);
    await changeProfileChain(newChain);
    mutate("getProfiles", { ...profiles, chain: newChain }, true);
  });

  const onEnhanceDelete = useLockFn(async (uid: string) => {
    try {
      await onEnhanceDisable(uid);
      await deleteProfile(uid);
      mutate("getProfiles");
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onMoveTop = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = [uid].concat(chain.filter((i) => i !== uid));
    await changeProfileChain(newChain);
    mutate("getProfiles", { ...profiles, chain: newChain }, true);
  });

  const onMoveEnd = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid).concat([uid]);
    await changeProfileChain(newChain);
    mutate("getProfiles", { ...profiles, chain: newChain }, true);
  });

  return (
    <BasePage title="Profiles">
      <Box sx={{ display: "flex", mb: 2.5 }}>
        <TextField
          id="clas_verge_profile_url"
          name="profile_url"
          label="Profile URL"
          size="small"
          fullWidth
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          sx={{ mr: 1 }}
        />
        <Button
          disabled={!url || disabled}
          variant="contained"
          onClick={onImport}
          sx={{ mr: 1 }}
        >
          Import
        </Button>
        <Button variant="contained" onClick={() => setDialogOpen(true)}>
          New
        </Button>
      </Box>

      <Grid container spacing={2}>
        {regularItems.map((item) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileItem
              selected={profiles.current === item.uid}
              itemData={item}
              onSelect={(f) => onSelect(item.uid, f)}
            />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} sx={{ mt: 3 }}>
        {enhanceItems.map((item) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileMore
              selected={!!profiles.chain?.includes(item.uid)}
              itemData={item}
              onEnable={() => onEnhanceEnable(item.uid)}
              onDisable={() => onEnhanceDisable(item.uid)}
              onDelete={() => onEnhanceDelete(item.uid)}
              onMoveTop={() => onMoveTop(item.uid)}
              onMoveEnd={() => onMoveEnd(item.uid)}
            />
          </Grid>
        ))}
      </Grid>

      <ProfileNew open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </BasePage>
  );
};

export default ProfilePage;
