import { useEffect, useState } from "react";

export const useVisibility = () => {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      setVisible(document.visibilityState === "visible");
    };

    const handleFocus = () => setVisible(true);
    const handlePointerDown = () => setVisible(true);

    document.addEventListener("focus", handleFocus);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("focus", handleFocus);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return visible;
};
