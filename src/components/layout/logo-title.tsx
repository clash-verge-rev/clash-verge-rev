import AppNameSvg from "@/assets/image/clash_verge.svg?react";
import LogoSvg from "@/assets/image/logo.svg?react";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useThemeMode } from "@/services/states";
import { DarkMode, LightMode } from "@mui/icons-material";
import { AnimatePresence, motion } from "framer-motion";

export const LogoTitle = () => {
  const { toggleTheme } = useCustomTheme();
  const mode = useThemeMode();
  const isDark = mode === "dark";

  return (
    <div
      className="flex flex-grow-0 flex-shrink-0 py-2 relative w-full box-border"
      data-tauri-drag-region="true">
      <div className="flex items-center justify-around px-5">
        <LogoSvg className="w-16 mr-1 h-full fill-[--primary-main]" />
        <AppNameSvg className="w-full h-full fill-[--primary-main]" />
      </div>
      <UpdateButton className="absolute top-0 left-16 scale-75" />
      <AnimatePresence>
        <motion.button
          key={isDark ? "dark" : "light"}
          initial={{ x: -25, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 20, opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute top-0 right-2 w-[30px] h-[30px] bg-transparent border-none cursor-pointer"
          onClick={(e) => toggleTheme(e, isDark ? "light" : "dark")}>
          {isDark ? (
            <DarkMode
              fontSize="inherit"
              className="w-full h-full fill-[--primary-main]"
            />
          ) : (
            <LightMode
              fontSize="inherit"
              className="w-full h-full fill-[--primary-main]"
            />
          )}
        </motion.button>
      </AnimatePresence>
    </div>
  );
};
