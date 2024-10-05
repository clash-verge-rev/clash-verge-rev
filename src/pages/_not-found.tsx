import { Box } from "@mui/material";

export const NotFountPage = () => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
      }}>
      <h1>Oops!</h1>
      <p style={{ color: "#888" }}>Not Found</p>
    </Box>
  );
};
