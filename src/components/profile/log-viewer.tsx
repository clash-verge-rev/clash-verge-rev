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
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

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
      <DialogTitle>{t("profiles.modals.logViewer.title")}</DialogTitle>

      <DialogContent
        sx={{
          width: 400,
          height: 300,
          overflowX: "hidden",
          userSelect: "text",
          pb: 1,
        }}
      >
        {logInfo.map(([level, log]) => (
          <Fragment key={`${level}-${log}`}>
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
          {t("shared.actions.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
