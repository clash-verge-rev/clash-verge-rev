import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { List, ListItem, ListItemText, Switch, TextField } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";

export const MiscViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    autoCloseConnection: false,
    defaultLatencyTest: "",
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        autoCloseConnection: verge?.auto_close_connection || false,
        defaultLatencyTest: verge?.default_latency_test || "",
      });
    },
    close: () => setOpen(false),
  }));

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
    <BaseDialog
      open={open}
      title={t("Miscellaneous")}
      contentSx={{ width: 420 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
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
    </BaseDialog>
  );
});
