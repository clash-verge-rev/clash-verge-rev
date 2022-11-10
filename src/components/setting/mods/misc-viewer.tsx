import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Switch,
  TextField,
} from "@mui/material";
import { ModalHandler } from "@/hooks/use-modal-handler";
import { useVergeConfig } from "@/hooks/use-verge-config";
import Notice from "@/components/base/base-notice";

interface Props {
  handler: ModalHandler;
}

const MiscViewer = ({ handler }: Props) => {
  const { t } = useTranslation();
  const { data, patchVerge } = useVergeConfig();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    autoCloseConnection: false,
    defaultLatencyTest: "",
  });

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  useEffect(() => {
    if (open) {
      setValues({
        autoCloseConnection: data?.auto_close_connection || false,
        defaultLatencyTest: data?.default_latency_test || "",
      });
    }
  }, [open, data]);

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({
        auto_close_connection: values.autoCloseConnection,
        default_latency_test: values.defaultLatencyTest,
      });
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle>{t("Miscellaneous")}</DialogTitle>

      <DialogContent sx={{ width: 420 }}>
        <List>
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText primary="Auto Close Connections" />
            <Switch
              edge="end"
              checked={values.autoCloseConnection}
              onChange={(_, c) =>
                setValues((v) => ({ ...v, autoCloseConnection: c }))
              }
            />
          </ListItem>

          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText primary="Default Latency Test" />
            <TextField
              size="small"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              sx={{ width: 200 }}
              value={values.defaultLatencyTest}
              placeholder="http://www.gstatic.com/generate_204"
              onChange={(e) =>
                setValues((v) => ({ ...v, defaultLatencyTest: e.target.value }))
              }
            />
          </ListItem>
        </List>
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </Button>
        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MiscViewer;
