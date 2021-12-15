import { useMemo, useState } from "react";
import { IconButton, Slide, Snackbar } from "@mui/material";
import { Close } from "@mui/icons-material";

interface NoticeInstance {
  info: (msg: string) => void;
  error: (msg: string) => void;
  success: (msg: string) => void;
}

const useNotice = () => {
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<"info" | "error" | "success">("info");

  const handleClose = (_e: any, reason: string) => {
    if (reason !== "clickaway") setMessage("");
  };

  const element = useMemo(
    () => (
      <Snackbar
        open={!!message}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        autoHideDuration={3000}
        onClose={handleClose}
        message={message}
        TransitionComponent={(p) => <Slide {...p} direction="left" />}
        action={
          <IconButton
            size="small"
            color="inherit"
            onClick={() => setMessage("")}
          >
            <Close fontSize="small" />
          </IconButton>
        }
      />
    ),
    [message]
  );

  const instance = (Object.fromEntries(
    (["info", "error", "success"] as const).map((item) => [
      item,
      (msg: string) => {
        setLevel(item);
        setMessage(msg);
      },
    ])
  ) as unknown) as NoticeInstance;

  return [instance, element] as const;
};

export default useNotice;
