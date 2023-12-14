import { Button } from "@mui/material";
import { appWindow } from "@tauri-apps/api/window";
import {
  CloseRounded,
  CropSquareRounded,
  FilterNoneRounded,
  HorizontalRuleRounded,
} from "@mui/icons-material";
import { useState } from "react";

export const LayoutControl = () => {
  const minWidth = 40;

  const [isMaximized, setIsMaximized] = useState(false);
  appWindow.isMaximized().then((isMaximized) => {
    setIsMaximized(() => isMaximized);
  });

  return (
    <>
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
          setIsMaximized((isMaximized) => !isMaximized);
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
        sx={{ minWidth, svg: { transform: "scale(1.05)" } }}
        onClick={() => appWindow.close()}
      >
        <CloseRounded fontSize="small" />
      </Button>
    </>
  );
};
