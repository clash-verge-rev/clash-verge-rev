import { useEffect, useRef } from "react";

import { hideInitialOverlay } from "../utils";

export const useLoadingOverlay = (themeReady: boolean) => {
  const overlayRemovedRef = useRef(false);

  useEffect(() => {
    if (!themeReady || overlayRemovedRef.current) return;

    let removalTimer: number | undefined;
    let retryTimer: number | undefined;
    let attempts = 0;
    const maxAttempts = 50;
    let stopped = false;

    const tryRemoveOverlay = () => {
      if (stopped || overlayRemovedRef.current) return;

      const { removed, removalTimer: timerId } = hideInitialOverlay({
        assumeMissingAsRemoved: true,
      });
      if (typeof timerId === "number") {
        removalTimer = timerId;
      }

      if (removed) {
        overlayRemovedRef.current = true;
        return;
      }

      if (attempts < maxAttempts) {
        attempts += 1;
        retryTimer = window.setTimeout(tryRemoveOverlay, 100);
      } else {
        console.warn("[Loading Overlay] Element not found");
      }
    };

    tryRemoveOverlay();

    return () => {
      stopped = true;
      if (typeof removalTimer === "number") window.clearTimeout(removalTimer);
      if (typeof retryTimer === "number") window.clearTimeout(retryTimer);
    };
  }, [themeReady]);
};
