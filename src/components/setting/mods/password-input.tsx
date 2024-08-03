import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";

interface Props {
  onConfirm: (passwd: string) => Promise<void>;
}

export const PasswordInput = (props: Props) => {
  const { onConfirm } = props;

  const { t } = useTranslation();
  const [passwd, setPasswd] = useState("");

  useEffect(() => {
    if (!open) return;
  }, [open]);

  return (
    <Dialog open={true} maxWidth="xs" fullWidth>
      <DialogTitle>{t("Please enter your root password")}</DialogTitle>

      <DialogContent>
        <TextField
          sx={{ mt: 1 }}
          autoFocus
          label={t("Password")}
          fullWidth
          size="small"
          type="password"
          value={passwd}
          onKeyDown={(e) => e.key === "Enter" && onConfirm(passwd)}
          onChange={(e) => setPasswd(e.target.value)}
        ></TextField>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={async () => await onConfirm(passwd)}
          variant="contained"
        >
          {t("Confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
