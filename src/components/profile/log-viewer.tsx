import { BaseEmpty } from "@/components/base";
import { LogMessage } from "@/components/profile/profile-more";
import { useThemeMode } from "@/services/states";
import { Drawer } from "@mui/material";
import { Console } from "console-feed";

interface Props {
  open: boolean;
  logInfo: LogMessage[];
  onClose: () => void;
}

export const LogViewer = (props: Props) => {
  const { open, logInfo, onClose } = props;
  const themeMode = useThemeMode();

  const isDarkMode = themeMode === "dark";

  return (
    <Drawer
      sx={{ zIndex: 9999 }}
      anchor={"bottom"}
      open={open}
      onMouseDown={(e) => e.stopPropagation()}
      onClose={onClose}>
      <div
        style={{
          maxHeight: "50vh",
          minHeight: "20vh",
          overflow: "auto",
          backgroundColor: isDarkMode ? "#242424" : "#fff",
        }}>
        <Console
          logs={logInfo}
          styles={{ BASE_FONT_SIZE: 12 }}
          variant={isDarkMode ? "dark" : "light"}
        />
        {logInfo.length === 0 && <BaseEmpty />}
      </div>
    </Drawer>
  );
};
