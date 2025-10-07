import { useEffect, useState } from "react";

export const useVisibility = () => {
  const [visible, setVisible] = useState(true);

  const setupVisibilityListeners = () => {
    const handleVisibilityChange = () => {
      setVisible(document.visibilityState === "visible");
    };

    const handleFocus = () => setVisible(true);
    const handleClick = () => setVisible(true);

    handleVisibilityChange();
    document.addEventListener("focus", handleFocus);
    document.addEventListener("pointerdown", handleClick);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("focus", handleFocus);
      document.removeEventListener("pointerdown", handleClick);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  };

  useEffect(() => {
    setupVisibilityListeners();
  }, []);

  return visible;
};
