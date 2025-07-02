import { setupNotificationPermission } from "../utils/notification-permission";
import { useEffect } from "react";

export function useNotificationPermission() {
  useEffect(() => {
    setupNotificationPermission();
  }, []);
}
