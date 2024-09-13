import { BaseEmpty } from "@/components/base";
import { LogMessage } from "@/components/profile/profile-more";
import { useThemeMode } from "@/services/states";
import { Drawer } from "@mui/material";
import { Console } from "console-feed";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  logInfo: LogMessage[];
  onClose: () => void;
}

export const LogViewer = (props: Props) => {
  const { open, logInfo, onClose } = props;
  const themeMode = useThemeMode();

  const { t } = useTranslation();
  const isDarkMode = themeMode === "dark";

  return (
    // <Dialog
    //   open={open}
    //   onClose={onClose}
    //   onMouseDown={(e) => e.stopPropagation()}>
    //   <DialogTitle>{t("Script Console")}</DialogTitle>

    //   <DialogContent
    //     sx={{
    //       width: 400,
    //       height: 300,
    //       overflowX: "hidden",
    //       userSelect: "text",
    //       pb: 1,
    //     }}>
    //     <Console logs={logInfo} variant="light" />
    //     {/* {logInfo.map(([level, log], index) => (
    //       <Fragment key={index.toString()}>
    //         <Typography color="text.secondary" component="div">
    //           <Chip
    //             label={level}
    //             size="small"
    //             variant="outlined"
    //             color={
    //               level === "error" || level === "exception"
    //                 ? "error"
    //                 : "default"
    //             }
    //             sx={{ mr: 1 }}
    //           />
    //           {log}
    //         </Typography>
    //         <Divider sx={{ my: 0.5 }} />
    //       </Fragment>
    //     ))} */}

    //     {logInfo.length === 0 && <BaseEmpty />}
    //   </DialogContent>

    //   <DialogActions>
    //     <Button onClick={onClose} variant="outlined">
    //       {t("Back")}
    //     </Button>
    //   </DialogActions>
    // </Dialog>
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
          paddingTop: "5px",
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
