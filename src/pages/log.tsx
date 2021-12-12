import { useEffect } from "react";
import { Box, Typography } from "@mui/material";
import services from "../services";

const LogPage = () => {
  useEffect(() => {
    const sourcePromise = services.getLogs(console.log);

    return () => {
      sourcePromise.then((src) => src.cancel());
    };
  }, []);

  return (
    <Box sx={{ width: 0.9, maxWidth: "850px", mx: "auto", mb: 2 }}>
      <Typography variant="h4" component="h1" sx={{ py: 2 }}>
        Logs
      </Typography>
    </Box>
  );
};

export default LogPage;
