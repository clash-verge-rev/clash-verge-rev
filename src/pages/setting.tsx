import { Box, Typography } from "@mui/material";
import SettingVerge from "../components/setting-verge";
import SettingClash from "../components/setting-clash";

const SettingPage = () => {
  return (
    <Box sx={{ width: 0.9, maxWidth: 850, mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Setting
      </Typography>

      <SettingVerge />

      <SettingClash />
    </Box>
  );
};

export default SettingPage;
