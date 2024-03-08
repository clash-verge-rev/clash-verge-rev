import getSystem from "@/utils/get-system";
const OS = getSystem();

// default theme setting
export const defaultTheme = {
  primary_color: "#0066cc",
  secondary_color: "#3a88bb",
  primary_text: "#1f1f1f",
  secondary_text: "#424245",
  info_color: "#0288d1",
  error_color: "#d32f2f",
  warning_color: "#ed6c02",
  success_color: "#2e7d32",
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
