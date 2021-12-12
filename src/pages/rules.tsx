import { useState } from "react";
import { invoke } from "@tauri-apps/api";
import { Box, Button, Grid, TextField, Typography } from "@mui/material";

const RulesPage = () => {
  const [url, setUrl] = useState("");

  const onClick = async () => {
    if (!url) return;
    const data = await invoke("cmd_import_profile", { url });
    console.log(data);
  };

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Rules
      </Typography>

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
    </Box>
  );
};

export default RulesPage;
