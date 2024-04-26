import { debounce } from "lodash-es";
import { useEffect, useState } from "react";

export const useWindowSize = () => {
  const [size, setSize] = useState({
    width: document.body.clientWidth,
    height: document.body.clientHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: document.body.clientWidth,
        height: document.body.clientHeight,
      });
    };

    window.addEventListener("resize", debounce(handleResize, 150));
    return () => {
      window.removeEventListener("resize", debounce(handleResize, 150));
    };
  }, []);

  return { size };
};
