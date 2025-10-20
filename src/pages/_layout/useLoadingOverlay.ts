import { useEffect, useRef } from "react";

export const useLoadingOverlay = (themeReady: boolean) => {
  const overlayRemovedRef = useRef(false);

  useEffect(() => {
    if (!themeReady || overlayRemovedRef.current) return;

    let fadeTimer: number | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;
    const maxAttempts = 50;
    let stopped = false;

    const tryRemoveOverlay = () => {
      if (stopped || overlayRemovedRef.current) return;

      const overlay = document.getElementById("initial-loading-overlay");
      if (overlay) {
        overlayRemovedRef.current = true;
        overlay.style.opacity = "0";
        overlay.style.pointerEvents = "none";

        fadeTimer = window.setTimeout(() => {
          try {
            overlay.remove();
          } catch (error) {
            console.warn("[加载遮罩] 移除失败:", error);
          }
        }, 300);
        return;
      }

      if (attempts < maxAttempts) {
        attempts += 1;
        retryTimer = window.setTimeout(tryRemoveOverlay, 100);
      } else {
        console.warn("[加载遮罩] 未找到元素");
      }
    };

    tryRemoveOverlay();

    return () => {
      stopped = true;
      if (fadeTimer) window.clearTimeout(fadeTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [themeReady]);
};
