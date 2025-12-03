import { useEffect } from "react";

import { useVerge } from "./use-verge";
import { useWindow } from "./use-window";

/**
 * Hook to handle ESC key press to hide window to tray
 * Only works when enabled in settings
 */
export const useEscMinimize = () => {
  const { verge } = useVerge();
  const { currentWindow } = useWindow();

  useEffect(() => {
    if (!verge?.enable_esc_to_minimize) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if ESC key is pressed
      if (event.key === "Escape") {
        // Don't minimize if user is typing in an input field
        const target = event.target as HTMLElement;
        const isInputField =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (!isInputField) {
          event.preventDefault();
          currentWindow.hide();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [verge?.enable_esc_to_minimize, currentWindow]);
};
