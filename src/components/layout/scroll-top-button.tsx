import { IconButton, Fade, SxProps, Theme } from "@mui/material";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";

interface Props {
  onClick: () => void;
  show: boolean;
  sx?: SxProps<Theme>;
}

export const ScrollTopButton = ({ onClick, show, sx }: Props) => {
  return (
    <Fade in={show}>
      <IconButton
        onClick={onClick}
        sx={{
          position: "absolute",
          bottom: "20px",
          right: "20px",
          backgroundColor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(255,255,255,0.1)"
              : "rgba(0,0,0,0.1)",
          "&:hover": {
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255,255,255,0.2)"
                : "rgba(0,0,0,0.2)",
          },
          visibility: show ? "visible" : "hidden",
          ...sx,
        }}
      >
        <KeyboardArrowUpIcon />
      </IconButton>
    </Fade>
  );
};
