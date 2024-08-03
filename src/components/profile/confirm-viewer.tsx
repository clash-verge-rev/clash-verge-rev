import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";

interface Props {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
}

export const ConfirmViewer = (props: Props) => {
  const { open, title, message, onClose, onConfirm } = props;

  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent sx={{ pb: 1, userSelect: "text" }}>
        {message}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t("Cancel")}
        </Button>
        <Button onClick={onConfirm} variant="contained">
          {t("Confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
