import { Box, IconButton } from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import MinimizeRoundedIcon from "@mui/icons-material/MinimizeRounded";
import CropSquareRoundedIcon from "@mui/icons-material/CropSquareRounded";

export const LayoutControl = () => {
  const appWindow = getCurrentWebviewWindow();
  const handleClose = () => appWindow.close();
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        WebkitAppRegion: "no-drag",
      }}
    >
      <IconButton
        aria-label="minimize"
        onClick={handleMinimize}
        size="small"
        sx={{ color: "text.secondary" }}
      >
        <MinimizeRoundedIcon fontSize="small" />
      </IconButton>

      <IconButton
        aria-label="maximize"
        onClick={handleMaximize}
        size="small"
        sx={{ color: "text.secondary" }}
      >
        <CropSquareRoundedIcon fontSize="small" />
      </IconButton>

      <IconButton
        aria-label="close"
        onClick={handleClose}
        size="small"
        sx={{ color: "text.secondary" }}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}; 