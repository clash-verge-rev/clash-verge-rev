import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  InputAdornment,
} from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";

export const MiscViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    appLogLevel: "info",
    autoCloseConnection: true,
    autoCheckUpdate: true,
    enableBuiltinEnhanced: true,
    proxyLayoutColumn: 6,
    defaultLatencyTest: "",
    autoLogClean: 0,
    defaultLatencyTimeout: 10000,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        appLogLevel: verge?.app_log_level ?? "info",
        autoCloseConnection: verge?.auto_close_connection ?? true,
        autoCheckUpdate: verge?.auto_check_update ?? true,
        enableBuiltinEnhanced: verge?.enable_builtin_enhanced ?? true,
        proxyLayoutColumn: verge?.proxy_layout_column || 6,
        defaultLatencyTest: verge?.default_latency_test || "",
        autoLogClean: verge?.auto_log_clean || 0,
        defaultLatencyTimeout: verge?.default_latency_timeout || 10000,
      });
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({
        app_log_level: values.appLogLevel,
        auto_close_connection: values.autoCloseConnection,
        auto_check_update: values.autoCheckUpdate,
        enable_builtin_enhanced: values.enableBuiltinEnhanced,
        proxy_layout_column: values.proxyLayoutColumn,
        default_latency_test: values.defaultLatencyTest,
        default_latency_timeout: values.defaultLatencyTimeout,
        auto_log_clean: values.autoLogClean as any,
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
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                appLogLevel: e.target.value as string,
              }))
            }
          >
            {["trace", "debug", "info", "warn", "error", "silent"].map((i) => (
              <MenuItem value={i} key={i}>
                {i[0].toUpperCase() + i.slice(1).toLowerCase()}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("Auto Close Connections")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("Auto Close Connections Info")}
            sx={{ opacity: "0.7" }}
          />
          <Switch
            edge="end"
            checked={values.autoCloseConnection}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoCloseConnection: c }))
            }
            sx={{ marginLeft: "auto" }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Check Update")} />
          <Switch
            edge="end"
            checked={values.autoCheckUpdate}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoCheckUpdate: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("Enable Builtin Enhanced")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("Enable Builtin Enhanced Info")}
            sx={{ opacity: "0.7" }}
          />
          <Switch
            edge="end"
            checked={values.enableBuiltinEnhanced}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, enableBuiltinEnhanced: c }))
            }
            sx={{ marginLeft: "auto" }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Proxy Layout Columns")} />
          <Select
            size="small"
            sx={{ width: 135, "> div": { py: "7.5px" } }}
            value={values.proxyLayoutColumn}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                proxyLayoutColumn: e.target.value as number,
              }))
            }
          >
            <MenuItem value={6} key={6}>
              {t("Auto Columns")}
            </MenuItem>
            {[1, 2, 3, 4, 5].map((i) => (
              <MenuItem value={i} key={i}>
                {i}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Log Clean")} />
          <Select
            size="small"
            sx={{ width: 135, "> div": { py: "7.5px" } }}
            value={values.autoLogClean}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                autoLogClean: e.target.value as number,
              }))
            }
          >
            {[
              { key: t("Never Clean"), value: 0 },
              { key: t("Retain _n Days", { n: 7 }), value: 1 },
              { key: t("Retain _n Days", { n: 30 }), value: 2 },
              { key: t("Retain _n Days", { n: 90 }), value: 3 },
            ].map((i) => (
              <MenuItem key={i.value} value={i.value}>
                {i.key}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("Default Latency Test")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("Default Latency Test Info")}
            sx={{ opacity: "0.7" }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250, marginLeft: "auto" }}
            value={values.defaultLatencyTest}
            placeholder="http://cp.cloudflare.com/generate_204"
            onChange={(e) =>
              setValues((v) => ({ ...v, defaultLatencyTest: e.target.value }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Default Latency Timeout")} />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.defaultLatencyTimeout}
            placeholder="10000"
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                defaultLatencyTimeout: parseInt(e.target.value),
              }))
            }
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">{t("millis")}</InputAdornment>
              ),
            }}
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
