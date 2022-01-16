import ReactDOM from "react-dom";
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
  const { type, message, duration = 2000, onClose } = props;
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
      <Box sx={{ display: "flex", alignItems: "center" }}>
        {type === "error" && <ErrorRounded color="error" />}
        {type === "success" && <CheckCircleRounded color="success" />}

        <Typography sx={{ ml: 1 }}>{message}</Typography>
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
const Notice: NoticeInstance = (props) => {
  if (!parent) {
    parent = document.createElement("div");
    document.body.appendChild(parent);
  }

  const container = document.createElement("div");
  parent.appendChild(container);

  const onUnmount = () => {
    const result = ReactDOM.unmountComponentAtNode(container);
    if (result && parent) parent.removeChild(container);
  };

  ReactDOM.render(<NoticeInner {...props} onClose={onUnmount} />, container);
};

(["info", "error", "success"] as const).forEach((type) => {
  Notice[type] = (message, duration) => Notice({ type, message, duration });
});

export default Notice;
