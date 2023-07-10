import { useEffect, useState } from "react";

export const useVisibility = () => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setVisible(document.visibilityState === "visible");
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return visible;
};
