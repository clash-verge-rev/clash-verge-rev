import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Box, Button, Grid, TextField, Typography } from "@mui/material";
import {
  getProfiles,
  selectProfile,
  patchProfile,
  importProfile,
} from "../services/cmds";
import { getProxies, updateProxy } from "../services/api";
import ProfileItemComp from "../components/profile-item";
import useNotice from "../utils/use-notice";
import noop from "../utils/noop";

const ProfilePage = () => {
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [notice, noticeElement] = useNotice();

  const { mutate } = useSWRConfig();
  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  useEffect(() => {
    if (profiles.current == null) return;
    if (!profiles.items) profiles.items = [];

    const profile = profiles.items![profiles.current];
    if (!profile) return;

    getProxies().then((proxiesData) => {
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
      patchProfile(profiles.current!, profile).catch(console.error);
      // update proxies cache
      if (hasChange) mutate("getProxies", getProxies());
    });
  }, [profiles]);

  const onImport = async () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);

    try {
      await importProfile(url);
      mutate("getProfiles", getProfiles());
      if (!profiles.items?.length) selectProfile(0).catch(noop);
      notice.success("Successfully import profile.");
    } catch {
      notice.error("Failed to import profile.");
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
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2, mb: 1 }}>
        Profiles
      </Typography>

      <Box sx={{ display: "flex", mb: 3 }}>
        <TextField
          id="profile_url"
          name="profile_url"
          label="Profile URL"
          size="small"
          fullWidth
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          sx={{ mr: 4 }}
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
            <ProfileItemComp
              index={idx}
              selected={profiles.current === idx}
              itemData={item}
              onClick={() => onProfileChange(idx)}
            />
          </Grid>
        ))}
      </Grid>

      {noticeElement}
    </Box>
  );
};

export default ProfilePage;
