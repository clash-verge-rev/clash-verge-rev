import getSystem from "@/utils/get-system";
const OS = getSystem();

// default theme setting
export const defaultTheme = {
  primary_color: "#4D84FF",
  secondary_color: "#9D7CD8",
  primary_text: "#2C2C2E",
  secondary_text: "#3C3C4399",
  info_color: "#4D84FF",
  error_color: "#F56565",
  warning_color: "#EF9F4B",
  success_color: "#48BB78",
  background_color: "#F5F7FA",
  font_family: `-apple-system, BlinkMacSystemFont,"Microsoft YaHei UI", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji"${
    OS === "windows" ? ", twemoji mozilla" : ""
  }`,
};

// dark mode
export const defaultDarkTheme = {
  ...defaultTheme,
  primary_color: "#60A5FA",
  secondary_color: "#B794F4",
  primary_text: "#F0F0F0",
  background_color: "#1A1C2A",
  secondary_text: "#EBEBF599",
  info_color: "#60A5FA",
  error_color: "#FC8181",
  warning_color: "#F6AD55",
  success_color: "#68D391",
};
