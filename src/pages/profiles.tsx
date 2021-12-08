import { useState } from "react";
import { invoke } from "@tauri-apps/api";
import { Button, Grid, TextField } from "@mui/material";

const ProfilesPage = () => {
  const [url, setUrl] = useState("");

  const onClick = async () => {
    if (!url) return;
    const data = await invoke("get_config_data", { url });
    console.log(data);
  };

  return (
    <div>
      <Grid
        container
        spacing={2}
        justifyContent="space-between"
        alignItems="center"
      >
        <Grid item xs={9}>
          <TextField
            label="Profile Url"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Grid>
        <Grid item>
          <Button size="large" variant="contained" onClick={onClick}>
            View
          </Button>
        </Grid>
      </Grid>
    </div>
  );
};

export default ProfilesPage;
