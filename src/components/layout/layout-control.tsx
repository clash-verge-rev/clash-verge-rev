import { Button, ButtonGroup } from "@mui/material";
import { Window } from "@tauri-apps/api/window";
import {
  CloseRounded,
  CropSquareRounded,
  FilterNoneRounded,
  HorizontalRuleRounded,
  PushPinOutlined,
  PushPinRounded,
} from "@mui/icons-material";
import { useState } from "react";

export const LayoutControl = () => {
  const minWidth = 40;

  const [isMaximized, setIsMaximized] = useState(false);
  const [isPined, setIsPined] = useState(false);
  Window.getCurrent()
    .isMaximized()
    .then((isMaximized) => {
      setIsMaximized(() => isMaximized);
    });

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
          Window.getCurrent().setAlwaysOnTop(!isPined);
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
        onClick={() => Window.getCurrent().minimize()}
      >
        <HorizontalRuleRounded fontSize="small" />
      </Button>

      <Button
        size="small"
        sx={{ minWidth, svg: { transform: "scale(0.9)" } }}
        onClick={() => {
          setIsMaximized((isMaximized) => !isMaximized);
          Window.getCurrent().toggleMaximize();
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
        onClick={() => Window.getCurrent().close()}
      >
        <CloseRounded fontSize="small" />
      </Button>
    </ButtonGroup>
  );
};
