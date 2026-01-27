import { Button } from "@mui/material";
import { useRef } from "react";

import { DialogRef } from "@/components/base";
import { useUpdate } from "@/hooks/use-update";

import { UpdateViewer } from "../setting/mods/update-viewer";

interface Props {
  className?: string;
}

export const UpdateButton = (props: Props) => {
  const { className } = props;
  const viewerRef = useRef<DialogRef>(null);

  const { updateInfo } = useUpdate();

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
