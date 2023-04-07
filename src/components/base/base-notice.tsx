import { createRoot } from "react-dom/client";
import { ReactNode, useState } from "react";
import { Box, IconButton, Slide, Snackbar, Typography } from "@mui/material";
import { Close, CheckCircleRounded, ErrorRounded } from "@mui/icons-material";

interface InnerProps {
  type: string;
  duration?: number;
  message: ReactNode;
  onClose: () => void;
}

const NoticeInner = (props: InnerProps) => {
  const { type, message, duration = 1500, onClose } = props;
  const [visible, setVisible] = useState(true);

  const onBtnClose = () => {
    setVisible(false);
    onClose();
  };
  const onAutoClose = (_e: any, reason: string) => {
    if (reason !== "clickaway") onBtnClose();
  };

  const msgElement =
    type === "info" ? (
      message
    ) : (
      <Box sx={{ width: 328, display: "flex", alignItems: "center" }}>
        {type === "error" && <ErrorRounded color="error" />}
        {type === "success" && <CheckCircleRounded color="success" />}

        <Typography
          component="span"
          sx={{ ml: 1, wordWrap: "break-word", width: "calc(100% - 35px)" }}
        >
          {message}
        </Typography>
      </Box>
    );

  return (
    <Snackbar
      open={visible}
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
      autoHideDuration={duration}
      onClose={onAutoClose}
      message={msgElement}
      sx={{ maxWidth: 360 }}
      TransitionComponent={(p) => <Slide {...p} direction="left" />}
      transitionDuration={200}
      action={
        <IconButton size="small" color="inherit" onClick={onBtnClose}>
          <Close fontSize="inherit" />
        </IconButton>
      }
    />
  );
};

interface NoticeInstance {
  (props: Omit<InnerProps, "onClose">): void;

  info(message: ReactNode, duration?: number): void;
  error(message: ReactNode, duration?: number): void;
  success(message: ReactNode, duration?: number): void;
}

let parent: HTMLDivElement = null!;

// @ts-ignore
export const Notice: NoticeInstance = (props) => {
  if (!parent) {
    parent = document.createElement("div");
    document.body.appendChild(parent);
  }

  const container = document.createElement("div");
  parent.appendChild(container);
  const root = createRoot(container);

  const onUnmount = () => {
    root.unmount();
    if (parent) setTimeout(() => parent.removeChild(container), 500);
  };

  root.render(<NoticeInner {...props} onClose={onUnmount} />);
};

(["info", "error", "success"] as const).forEach((type) => {
  Notice[type] = (message, duration) => {
    setTimeout(() => Notice({ type, message, duration }), 0);
  };
});
