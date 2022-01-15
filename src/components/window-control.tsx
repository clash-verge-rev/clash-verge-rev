import { Button } from "@mui/material";
import { appWindow } from "@tauri-apps/api/window";
import {
  CloseRounded,
  CropLandscapeOutlined,
  HorizontalRuleRounded,
} from "@mui/icons-material";

const WindowControl = () => {
  return (
    <>
      <Button
        size="small"
        sx={{ minWidth: 48 }}
        onClick={() => appWindow.minimize()}
      >
        <HorizontalRuleRounded />
      </Button>

      <Button
        size="small"
        sx={{ minWidth: 48 }}
        onClick={() => appWindow.toggleMaximize()}
      >
        <CropLandscapeOutlined />
      </Button>

      <Button
        size="small"
        sx={{ minWidth: 48 }}
        onClick={() => appWindow.hide()}
      >
        <CloseRounded />
      </Button>
    </>
  );
};

export default WindowControl;
