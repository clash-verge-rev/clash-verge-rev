import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onConfirm: (passwd: string) => Promise<void>;
}

export const PasswordInput = (props: Props) => {
  const { onConfirm } = props;

  const { t } = useTranslation();
  const [passwd, setPasswd] = useState("");

  return (
    <Dialog open={true} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t("settings.modals.password.prompts.enterRoot")}
      </DialogTitle>

      <DialogContent>
        <TextField
          sx={{ mt: 1 }}
          autoFocus
          label={t("shared.labels.password")}
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
          {t("shared.actions.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
