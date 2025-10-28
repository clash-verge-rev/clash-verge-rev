import { useEffect, useRef } from "react";

export const useLazyDataLoad = (
  callbacks: Array<() => void>,
  delay: number = 1000,
) => {
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;

    const timer = window.setTimeout(() => {
      hasLoadedRef.current = true;
      callbacks.forEach((callback) => {
        try {
          callback();
        } catch (error) {
          console.error("[延迟加载] 执行失败:", error);
        }
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [callbacks, delay]);
};
