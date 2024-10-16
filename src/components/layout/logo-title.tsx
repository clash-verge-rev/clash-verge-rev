import AppNameSvg from "@/assets/image/clash_verge.svg?react";
import LogoSvg from "@/assets/image/logo.svg?react";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useThemeMode } from "@/services/states";
import { cn } from "@/utils";
import { DarkMode, LightMode } from "@mui/icons-material";
import { AnimatePresence, motion } from "framer-motion";

export const LogoTitle = ({ open }: { open: boolean }) => {
  const { toggleTheme } = useCustomTheme();
  const mode = useThemeMode();
  const isDark = mode === "dark";

  return (
    <div
      className="relative box-border flex w-full flex-shrink-0 flex-grow-0 pt-2"
      data-tauri-drag-region="true">
      <div className="flex items-center justify-around px-5">
        <div>
          <LogoSvg
            className={cn(
              "mr-1 h-full w-12 fill-primary-main transition-all duration-200",
              { "w-16": !open },
            )}
          />
        </div>
        <div>
          <AppNameSvg
            className={cn("h-full w-full fill-[--primary-main]", {
              hidden: !open,
            })}
          />
        </div>
      </div>
      <UpdateButton
        className={cn("absolute left-0 top-0 scale-[0.7]", {
          "left-16 top-0 scale-75": open,
        })}
      />
      <AnimatePresence>
        <motion.button
          key={isDark ? "dark" : "light"}
          initial={{ x: -25, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 20, opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute right-2 top-0 z-50 h-[30px] w-[30px] cursor-pointer border-none bg-transparent"
          onClick={(e) => toggleTheme(e, isDark ? "light" : "dark")}>
          {isDark ? (
            <DarkMode
              fontSize="inherit"
              className="h-full w-full fill-[--primary-main]"
            />
          ) : (
            <LightMode
              fontSize="inherit"
              className="h-full w-full fill-[--primary-main]"
            />
          )}
        </motion.button>
      </AnimatePresence>
    </div>
  );
};
