import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLocalStorage } from "foxact/use-local-storage";
import debounce from "lodash-es/debounce";
import { useEffect } from "react";
const appWindow = getCurrentWebviewWindow();

export const useWindowSize = () => {
  const [size, setSize] = useLocalStorage(
    "window-size",
    { height: 642, width: 800 },
    {
      serializer: JSON.stringify,
      deserializer: JSON.parse,
    },
  );

  useEffect(() => {
    appWindow.innerSize().then((windowSize) => {
      setSize({
        width: windowSize.width,
        height: windowSize.height,
      });
    });

    const handleResize = () => {
      setSize({
        width: document.body.clientWidth,
        height: document.body.clientHeight,
      });
    };

    window.addEventListener("resize", debounce(handleResize, 100));
    return () => {
      window.removeEventListener("resize", debounce(handleResize, 100));
    };
  }, []);

  return { size };
};
