import { useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { importProfile } from "../services/command";
import useNotice from "../utils/use-notice";

const RulesPage = () => {
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);

  const [notice, noticeElement] = useNotice();

  const onClick = () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);
    importProfile(url)
      .then(() => notice.success("Successfully import profile."))
      .catch(() => notice.error("Failed to import profile."))
      .finally(() => setDisabled(false));
  };

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2, mb: 1 }}>
        Rules
      </Typography>

      <Box sx={{ display: "flex" }}>
        <TextField
          label="Profile URL"
          size="small"
          fullWidth
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          sx={{ mr: 4 }}
        />
        <Button disabled={disabled} variant="contained" onClick={onClick}>
          Import
        </Button>
      </Box>

      {noticeElement}
    </Box>
  );
};

export default RulesPage;
