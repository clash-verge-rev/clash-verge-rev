import getSystem from "@/utils/get-system";
const OS = getSystem();

// default theme setting
export const defaultTheme = {
  primary_color: "#1890ff",
  secondary_color: "#f5222d",
  primary_text: "#1f1f1f",
  secondary_text: "#8c8c8c",
  info_color: "#1677ff",
  error_color: "#f5222d",
  warning_color: "#faad14",
  success_color: "#52c41a",
  background_color: "#f5f5f5",
  font_family: `"Roboto", "Helvetica", "Arial", sans-serif, ${
    OS === "windows" ? "twemoji mozilla" : ""
  }`,
};

// dark mode
export const defaultDarkTheme = {
  ...defaultTheme,
  primary_text: "#ffffff",
  background_color: "#2e303d",
  secondary_text: "#ffffff",
};
