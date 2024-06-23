import { Box, Typography } from "@mui/material";
import { ClimbingBoxLoader } from "react-spinners";

export default function LoadingPage() {
  return (
    <Box
      height={"100%"}
      width={"100%"}
      display={"flex"}
      flexDirection={"column"}
      justifyContent={"center"}
      alignItems={"center"}
      sx={{ bgcolor: "var(--background-color)" }}>
      <Typography variant="h4" sx={{ color: "var(--primary-main)" }}>
        Loading...
      </Typography>
      <ClimbingBoxLoader color="var(--primary-main)" />
    </Box>
  );
}
