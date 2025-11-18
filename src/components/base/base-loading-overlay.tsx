import { Box, CircularProgress } from "@mui/material";
import React from "react";

interface BaseLoadingOverlayProps {
  isLoading: boolean;
}

export const BaseLoadingOverlay: React.FC<BaseLoadingOverlayProps> = ({
  isLoading,
}) => {
  if (!isLoading) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        // Respect current theme; avoid bright flash in dark mode
        backgroundColor: (theme) =>
          theme.palette.mode === "dark"
            ? "rgba(0, 0, 0, 0.5)"
            : "rgba(255, 255, 255, 0.7)",
        zIndex: 1000,
      }}
    >
      <CircularProgress />
    </Box>
  );
};
