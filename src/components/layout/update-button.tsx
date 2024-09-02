import useSWR from "swr";
import { useRef } from "react";
import { Button } from "@mui/material";
import { check } from "@tauri-apps/plugin-updater";
import { UpdateViewer } from "../setting/mods/update-viewer";
import { DialogRef } from "../base";
import { useVerge } from "@/hooks/use-verge";

interface Props {
  className?: string;
}

export const UpdateButton = (props: Props) => {
  const { className } = props;
  const { verge } = useVerge();
  const { auto_check_update } = verge || {};

  const viewerRef = useRef<DialogRef>(null);

  const { data: updateInfo } = useSWR(
    auto_check_update || auto_check_update === null ? "checkUpdate" : null,
    check,
    {
      errorRetryCount: 2,
      revalidateIfStale: false,
      focusThrottleInterval: 36e5, // 1 hour
    }
  );

  if (!updateInfo?.available) return null;

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
