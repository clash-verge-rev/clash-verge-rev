import React, { useSyncExternalStore } from "react";
import { Snackbar, Alert, IconButton, Box } from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import {
  subscribeNotices,
  hideNotice,
  getSnapshotNotices,
} from "@/services/noticeService";

export const NoticeManager: React.FC = () => {
  const currentNotices = useSyncExternalStore(
    subscribeNotices,
    getSnapshotNotices,
  );

  const handleClose = (id: number) => {
    hideNotice(id);
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: 1500,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        maxWidth: "360px",
      }}
    >
      {currentNotices.map((notice) => (
        <Snackbar
          key={notice.id}
          open={true}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          sx={{
            position: "relative",
            transform: "none",
            top: "auto",
            right: "auto",
            bottom: "auto",
            left: "auto",
            width: "100%",
          }}
        >
          <Alert
            severity={notice.type}
            variant="filled"
            sx={{ width: "100%" }}
            action={
              <IconButton
                size="small"
                color="inherit"
                onClick={() => handleClose(notice.id)}
              >
                <CloseRounded fontSize="inherit" />
              </IconButton>
            }
          >
            {notice.message}
          </Alert>
        </Snackbar>
      ))}
    </Box>
  );
};
