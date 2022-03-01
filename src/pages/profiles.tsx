import useSWR, { useSWRConfig } from "swr";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, Grid, TextField } from "@mui/material";
import {
  getProfiles,
  selectProfile,
  patchProfile,
  importProfile,
  newProfile,
} from "../services/cmds";
import { getProxies, updateProxy } from "../services/api";
import Notice from "../components/base/base-notice";
import BasePage from "../components/base/base-page";
import ProfileItem from "../components/profile/profile-item";
import ProfileNew from "../components/profile/profile-new";

const ProfilePage = () => {
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);

  const { mutate } = useSWRConfig();
  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  useEffect(() => {
    if (profiles.current == null) return;
    if (!profiles.items) profiles.items = [];

    const current = profiles.current;
    const profile = profiles.items.find((p) => p.uid === current);
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
  }, [profiles]);

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

  const onSelect = useLockFn(async (current: string, force: boolean) => {
    if (!force && current === profiles.current) return;

    try {
      await selectProfile(current);
      mutate("getProfiles", { ...profiles, current: current }, true);
    } catch (err: any) {
      err && Notice.error(err.toString());
    }
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const onNew = useLockFn(async (name: string, desc: string) => {
    try {
      await newProfile(name, desc);
      setDialogOpen(false);
      mutate("getProfiles");
    } catch (err: any) {
      err && Notice.error(err.toString());
    }
  });

  return (
    <BasePage title="Profiles">
      <Box sx={{ display: "flex", mb: 3 }}>
        <TextField
          id="profile_url"
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

      <Grid container spacing={3}>
        {profiles?.items?.map((item) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileItem
              selected={profiles.current === item.uid}
              itemData={item}
              onSelect={(f) => onSelect(item.uid, f)}
            />
          </Grid>
        ))}
      </Grid>

      <ProfileNew
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={onNew}
      />
    </BasePage>
  );
};

export default ProfilePage;
