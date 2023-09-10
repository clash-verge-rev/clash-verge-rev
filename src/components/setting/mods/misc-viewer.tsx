import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Switch,
  TextField,
} from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";

export const MiscViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    appLogLevel: "info",
    autoCloseConnection: false,
    enableClashFields: true,
    enableBuiltinEnhanced: true,
    proxyLayoutColumn: 6,
    defaultLatencyTest: "",
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        appLogLevel: verge?.app_log_level ?? "info",
        autoCloseConnection: verge?.auto_close_connection ?? false,
        enableClashFields: verge?.enable_clash_fields ?? true,
        enableBuiltinEnhanced: verge?.enable_builtin_enhanced ?? true,
        proxyLayoutColumn: verge?.proxy_layout_column || 6,
        defaultLatencyTest: verge?.default_latency_test || "",
      });
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({
        app_log_level: values.appLogLevel,
        auto_close_connection: values.autoCloseConnection,
        enable_clash_fields: values.enableClashFields,
        enable_builtin_enhanced: values.enableBuiltinEnhanced,
        proxy_layout_column: values.proxyLayoutColumn,
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
      contentSx={{ width: 450 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("App Log Level")} />
          <Select
            size="small"
            sx={{ width: 100, "> div": { py: "7.5px" } }}
            value={values.appLogLevel}
            onChange={(e) => {
              setValues((v) => ({
                ...v,
                appLogLevel: e.target.value as string,
              }));
            }}
          >
            {["trace", "debug", "info", "warn", "error", "silent"].map((i) => (
              <MenuItem value={i} key={i}>
                {i[0].toUpperCase() + i.slice(1).toLowerCase()}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Close Connections")} />
          <Switch
            edge="end"
            checked={values.autoCloseConnection}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoCloseConnection: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Enable Clash Fields Filter")} />
          <Switch
            edge="end"
            checked={values.enableClashFields}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, enableClashFields: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Enable Builtin Enhanced")} />
          <Switch
            edge="end"
            checked={values.enableBuiltinEnhanced}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, enableBuiltinEnhanced: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Proxy Layout Column")} />
          <Select
            size="small"
            sx={{ width: 100, "> div": { py: "7.5px" } }}
            value={values.proxyLayoutColumn}
            onChange={(e) => {
              setValues((v) => ({
                ...v,
                proxyLayoutColumn: e.target.value as number,
              }));
            }}
          >
            <MenuItem value={6} key={6}>
              Auto
            </MenuItem>
            {[1, 2, 3, 4, 5].map((i) => (
              <MenuItem value={i} key={i}>
                {i}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Default Latency Test")} />
          <TextField
            size="small"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
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
