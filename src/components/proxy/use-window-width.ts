import { debounce } from "@mui/material";
import { useEffect, useState } from "react";

export const useWindowSize = () => {
  const [width, setWidth] = useState(() => document.body.clientWidth);
  const [height, setHeight] = useState(() => document.body.clientHeight);

  useEffect(() => {
    const handleResize = () => {
      setWidth(document.body.clientWidth);
      setHeight(document.body.clientHeight);
    };

    window.addEventListener("resize", debounce(handleResize, 150));
    return () => {
      window.removeEventListener("resize", debounce(handleResize, 150));
    };
  }, []);

  return { width, height };
};
