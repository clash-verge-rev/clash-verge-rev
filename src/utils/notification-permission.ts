import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

export async function setupNotificationPermission() {
  let permission = await isPermissionGranted();
  if (!permission) {
    const result = await requestPermission();
    permission = result === "granted";
  }
  if (permission) {
    console.log("通知权限已授予");
  } else {
    console.log("通知权限被拒绝");
  }
}
