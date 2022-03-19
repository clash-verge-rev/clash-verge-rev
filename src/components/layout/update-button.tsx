import useSWR from "swr";
import { useState } from "react";
import { Button } from "@mui/material";
import { checkUpdate } from "@tauri-apps/api/updater";
import UpdateDialog from "./update-dialog";

interface Props {
  className?: string;
}

const UpdateButton = (props: Props) => {
  const { className } = props;

  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  if (!updateInfo?.shouldUpdate) return null;

  return (
    <>
      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => setDialogOpen(true)}
      >
        New
      </Button>

      {dialogOpen && (
        <UpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      )}
    </>
  );
};

export default UpdateButton;
