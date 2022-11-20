import useSWR from "swr";
import snarkdown from "snarkdown";
import { useMemo } from "react";
import { useRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
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
import { atomUpdateState } from "@/services/states";
import { Notice } from "@/components/base";

interface Props {
  open: boolean;
  onClose: () => void;
}

const UpdateLog = styled(Box)(() => ({
  "h1,h2,h3,ul,ol,p": { margin: "0.5em 0", color: "inherit" },
}));

const UpdateDialog = (props: Props) => {
  const { open, onClose } = props;
  const { t } = useTranslation();
  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  const [updateState, setUpdateState] = useRecoilState(atomUpdateState);

  const onUpdate = async () => {
    if (updateState) return;
    setUpdateState(true);

    try {
      await installUpdate();
      await relaunch();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      setUpdateState(false);
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
        <Button variant="outlined" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button
          autoFocus
          variant="contained"
          disabled={updateState}
          onClick={onUpdate}
        >
          {t("Update")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpdateDialog;
