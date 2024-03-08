import useSWR from "swr";
import { useRef } from "react";
import { Button } from "@mui/material";
import { checkUpdate } from "@tauri-apps/api/updater";
import { UpdateViewer } from "../setting/mods/update-viewer";
import { DialogRef } from "../base";

interface Props {
  className?: string;
}

export const UpdateButton = (props: Props) => {
  const { className } = props;

  const viewerRef = useRef<DialogRef>(null);

  const { data: updateInfo } = useSWR("checkUpdate", checkUpdate, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  if (!updateInfo?.shouldUpdate) return null;

  return (
    <>
      <UpdateViewer ref={viewerRef} />

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => viewerRef.current?.open()}
      >
        New
      </Button>
    </>
  );
};
