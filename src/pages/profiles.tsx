import useSWR, { useSWRConfig } from "swr";
import { useEffect, useRef, useState } from "react";
import { Box, Button, Grid, TextField } from "@mui/material";
import {
  getProfiles,
  selectProfile,
  patchProfile,
  importProfile,
} from "../services/cmds";
import { getProxies, updateProxy } from "../services/api";
import noop from "../utils/noop";
import Notice from "../components/notice";
import BasePage from "../components/base-page";
import ProfileItem from "../components/profile-item";

const ProfilePage = () => {
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);

  const { mutate } = useSWRConfig();
  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  useEffect(() => {
    if (profiles.current == null) return;
    if (!profiles.items) profiles.items = [];

    const current = profiles.current;
    const profile = profiles.items![current];
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
      mutate("getProfiles", getProfiles());
      if (!profiles.items?.length) selectProfile(0).catch(noop);
      Notice.success("Successfully import profile.");
    } catch {
      Notice.error("Failed to import profile.");
    } finally {
      setDisabled(false);
    }
  };

  const lockRef = useRef(false);
  const onProfileChange = (index: number) => {
    if (index === profiles.current || lockRef.current) return;
    if (lockRef.current) return;
    lockRef.current = true;
    selectProfile(index)
      .then(() => {
        mutate("getProfiles", { ...profiles, current: index }, true);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        lockRef.current = false;
      });
  };

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
          sx={{ mr: 2 }}
        />
        <Button
          disabled={!url || disabled}
          variant="contained"
          onClick={onImport}
        >
          Import
        </Button>
      </Box>

      <Grid container spacing={3}>
        {profiles?.items?.map((item, idx) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileItem
              index={idx}
              selected={profiles.current === idx}
              itemData={item}
              onClick={() => onProfileChange(idx)}
            />
          </Grid>
        ))}
      </Grid>
    </BasePage>
  );
};

export default ProfilePage;
