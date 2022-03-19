import useSWR from "swr";
import snarkdown from "snarkdown";
import { useState, useMemo } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  styled,
} from "@mui/material";
import { relaunch } from "@tauri-apps/api/process";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { killSidecars, restartSidecar } from "../../services/cmds";
import Notice from "../base/base-notice";

interface Props {
  open: boolean;
  onClose: () => void;
}

const UpdateLog = styled(Box)(() => ({
  "h1,h2,h3,ul,ol,p": { margin: "0.5em 0", color: "inherit" },
}));

let uploadingState = false;

const UpdateDialog = (props: Props) => {
  const { open, onClose } = props;
  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });
  const [uploading, setUploading] = useState(uploadingState);

  const onUpdate = async () => {
    setUploading(true);
    uploadingState = true;

    try {
      await installUpdate();
      await killSidecars();
      await relaunch();
    } catch (err: any) {
      await restartSidecar();
      Notice.error(err?.message || err.toString());
    } finally {
      setUploading(false);
      uploadingState = false;
    }
  };

  // markdown parser
  const parseContent = useMemo(() => {
    if (!updateInfo?.manifest?.body) {
      return "New Version is available";
    }
    return snarkdown(updateInfo?.manifest?.body);
  }, [updateInfo]);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>New Version v{updateInfo?.manifest?.version}</DialogTitle>

      <DialogContent sx={{ minWidth: 360, maxWidth: 400, maxHeight: "50vh" }}>
        <UpdateLog dangerouslySetInnerHTML={{ __html: parseContent }} />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          autoFocus
          variant="contained"
          disabled={uploading}
          onClick={onUpdate}
        >
          Update
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpdateDialog;
