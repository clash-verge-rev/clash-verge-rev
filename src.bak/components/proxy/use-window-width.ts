import { useEffect, useState } from "react";

export const useWindowWidth = () => {
  const [width, setWidth] = useState(() => document.body.clientWidth);

  useEffect(() => {
    const handleResize = () => setWidth(document.body.clientWidth);

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return { width };
};
