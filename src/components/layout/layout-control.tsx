import { Button, ButtonGroup } from "@mui/material";
import { appWindow } from "@tauri-apps/api/window";
import {
  CloseRounded,
  CropSquareRounded,
  FilterNoneRounded,
  HorizontalRuleRounded,
  PushPinOutlined,
  PushPinRounded,
} from "@mui/icons-material";
import { useState } from "react";
import { useVerge } from "@/hooks/use-verge";

interface Props {
  isMaximized: boolean;
}

export const LayoutControl = ({ isMaximized }: Props) => {
  const minWidth = 40;
  const { verge } = useVerge();
  const { enable_keep_ui_active } = verge ?? {};

  const [isPined, setIsPined] = useState(false);

  return (
    <ButtonGroup
      variant="text"
      sx={{
        height: "100%",
        ".MuiButtonGroup-grouped": {
          borderRadius: "0px",
          borderRight: "0px",
        },
      }}
    >
      <Button
        size="small"
        sx={{ minWidth, svg: { transform: "scale(0.9)" } }}
        onClick={() => {
          appWindow.setAlwaysOnTop(!isPined);
          setIsPined((isPined) => !isPined);
        }}
      >
        {isPined ? (
          <PushPinRounded fontSize="small" />
        ) : (
          <PushPinOutlined fontSize="small" />
        )}
      </Button>

      <Button
        size="small"
        sx={{ minWidth, svg: { transform: "scale(0.9)" } }}
        onClick={() => appWindow.minimize()}
      >
        <HorizontalRuleRounded fontSize="small" />
      </Button>

      <Button
        size="small"
        sx={{ minWidth, svg: { transform: "scale(0.9)" } }}
        onClick={() => {
          appWindow.toggleMaximize();
        }}
      >
        {isMaximized ? (
          <FilterNoneRounded
            fontSize="small"
            style={{
              transform: "rotate(180deg) scale(0.7)",
            }}
          />
        ) : (
          <CropSquareRounded fontSize="small" />
        )}
      </Button>

      <Button
        size="small"
        sx={{
          minWidth,
          svg: { transform: "scale(1.05)" },
          ":hover": { bgcolor: "#ff000090" },
        }}
        onClick={() => {
          if (enable_keep_ui_active) {
            appWindow.hide();
          } else {
            appWindow.close();
          }
        }}
      >
        <CloseRounded fontSize="small" />
      </Button>
    </ButtonGroup>
  );
};
