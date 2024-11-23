import React from "react";
import { Box, CircularProgress } from "@mui/material";

export interface BaseLoadingOverlayProps {
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
        backgroundColor: "rgba(255, 255, 255, 0.7)",
        zIndex: 1000,
      }}
    >
      <CircularProgress />
    </Box>
  );
};

export default BaseLoadingOverlay;
