import { Box, Typography } from "@mui/material";
import { ClimbingBoxLoader } from "react-spinners";

export default function LoadingPage() {
  return (
    <Box className="flex h-full w-full flex-col items-center justify-center bg-comment">
      <Typography className="text-primary-main" variant="h4">
        Loading...
      </Typography>
      <ClimbingBoxLoader color="var(--primary-main)" />
    </Box>
  );
}
