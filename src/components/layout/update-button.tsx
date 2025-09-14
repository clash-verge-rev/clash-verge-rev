import { useVerge } from "@/hooks/use-verge";
import { check } from "@tauri-apps/plugin-updater";
import React, { Suspense, useRef } from "react";
import useSWR from "swr";
import { DialogRef } from "../base";

const UpdateViewer = React.lazy(() =>
  import("../setting/mods/update-viewer").then((module) => ({
    default: module.UpdateViewer,
  })),
);

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
    },
  );

  if (!updateInfo) return null;

  return (
    <>
      <Suspense>
        <UpdateViewer ref={viewerRef} />
      </Suspense>

      <button
        style={{
          backgroundColor: "#FF4040",
          border: "none",
          color: "white",
          padding: "2px 10px",
          fontSize: "14px",
          fontWeight: 600,
          borderRadius: "4px",
        }}
        className={className}
        onClick={() => viewerRef.current?.open()}>
        New
      </button>
    </>
  );
};
