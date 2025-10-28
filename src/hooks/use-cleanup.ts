import { useEffect, useRef } from "react";

/**
 * 资源清理 Hook
 * 用于在组件卸载或窗口关闭时统一清理资源
 */
export const useCleanup = () => {
  const cleanupFnsRef = useRef<Set<() => void>>(new Set());

  const registerCleanup = (fn: () => void) => {
    cleanupFnsRef.current.add(fn);
    return () => {
      cleanupFnsRef.current.delete(fn);
    };
  };

  const cleanup = () => {
    cleanupFnsRef.current.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        console.error("[资源清理] 清理失败:", error);
      }
    });
    cleanupFnsRef.current.clear();
  };

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  return { registerCleanup, cleanup };
};
