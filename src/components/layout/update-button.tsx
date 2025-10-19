import { Button } from "@mui/material";
import { useRef } from "react";
import useSWR from "swr";

import { useVerge } from "@/hooks/use-verge";
import { checkUpdateSafe } from "@/services/update";

import { DialogRef } from "../base";
import { UpdateViewer } from "../setting/mods/update-viewer";

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
    checkUpdateSafe,
    {
      errorRetryCount: 2,
      revalidateIfStale: false,
      focusThrottleInterval: 36e5, // 1 hour
    },
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
