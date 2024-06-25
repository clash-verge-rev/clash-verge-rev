import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";
import { BaseEmpty } from "@/components/base";

interface Props {
  open: boolean;
  logInfo: [string, string][];
  onClose: () => void;
}

export const LogViewer = (props: Props) => {
  const { open, logInfo, onClose } = props;

  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("Script Console")}</DialogTitle>

      <DialogContent
        sx={{
          width: 400,
          height: 300,
          overflowX: "hidden",
          userSelect: "text",
          pb: 1,
        }}
      >
        {logInfo.map(([level, log], index) => (
          <Fragment key={index.toString()}>
            <Typography color="text.secondary" component="div">
              <Chip
                label={level}
                size="small"
                variant="outlined"
                color={
                  level === "error" || level === "exception"
                    ? "error"
                    : "default"
                }
                sx={{ mr: 1 }}
              />
              {log}
            </Typography>
            <Divider sx={{ my: 0.5 }} />
          </Fragment>
        ))}

        {logInfo.length === 0 && <BaseEmpty />}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t("Close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
