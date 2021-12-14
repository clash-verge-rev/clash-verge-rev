import { useState } from "react";
import {
  Box,
  Button,
  Grid,
  Slide,
  Snackbar,
  TextField,
  Typography,
} from "@mui/material";
import { importProfile } from "../services/command";

const RulesPage = () => {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [disabled, setDisabled] = useState(false);

  const onClick = () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);
    importProfile(url)
      .then(() => setMessage("Successfully import profile."))
      .catch(() => setMessage("Failed to import profile."))
      .finally(() => setDisabled(false));
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
            size="medium"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Grid>
        <Grid item>
          <Button
            disabled={disabled}
            size="large"
            variant="contained"
            onClick={onClick}
          >
            Import
          </Button>
        </Grid>
      </Grid>

      <Snackbar
        open={!!message}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        autoHideDuration={3000}
        onClose={() => setMessage("")}
        message={message}
        TransitionComponent={(p) => <Slide {...p} direction="left" />}
      />
    </Box>
  );
};

export default RulesPage;
