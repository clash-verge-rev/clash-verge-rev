import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Box, Button, Grid, TextField, Typography } from "@mui/material";
import { getProfiles, importProfile, putProfiles } from "../services/cmds";
import { getProxies } from "../services/api";
import ProfileItemComp from "../components/profile-item";
import useNotice from "../utils/use-notice";
import noop from "../utils/noop";

const ProfilePage = () => {
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [notice, noticeElement] = useNotice();

  const { mutate } = useSWRConfig();
  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  const onImport = async () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);

    try {
      await importProfile(url);
      mutate("getProfiles", getProfiles());
      if (!profiles.items?.length) putProfiles(0).catch(noop);
      notice.success("Successfully import profile.");
    } catch {
      notice.error("Failed to import profile.");
    } finally {
      setDisabled(false);
    }
  };

  const lockRef = useRef(false);
  const onProfileChange = (index: number) => {
    if (lockRef.current) return;
    lockRef.current = true;
    putProfiles(index)
      .then(() => {
        mutate("getProfiles", { ...profiles, current: index }, true);
        mutate("getProxies", getProxies());
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
