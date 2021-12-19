import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Box, Button, Grid, TextField, Typography } from "@mui/material";
import {
  getProfiles,
  importProfile,
  putProfiles,
  updateProfile,
} from "../services/command";
import ProfileItemComp from "../components/profile-item";
import useNotice from "../utils/use-notice";

const RulesPage = () => {
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [notice, noticeElement] = useNotice();

  const { mutate } = useSWRConfig();
  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  const onClick = () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);
    importProfile(url)
      .then(() => notice.success("Successfully import profile."))
      .catch(() => notice.error("Failed to import profile."))
      .finally(() => setDisabled(false));
  };

  const lockRef = useRef(false);
  const onProfileChange = (index: number) => {
    if (lockRef.current) return;
    lockRef.current = true;
    putProfiles(index)
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

  const onUpdateProfile = (index: number) => {
    updateProfile(index)
      .then(() => {
        mutate("getProfiles");
      })
      .catch((err) => {
        console.error(err);
      });
  };

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2, mb: 1 }}>
        Rules
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
          onClick={onClick}
        >
          Import
        </Button>
      </Box>

      <Grid container spacing={3}>
        {profiles?.items?.map((item, idx) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileItemComp
              selected={profiles.current === idx}
              itemData={item}
              onClick={() => onProfileChange(idx)}
              onUpdate={() => onUpdateProfile(idx)}
            />
          </Grid>
        ))}
      </Grid>

      {noticeElement}
    </Box>
  );
};

export default RulesPage;
