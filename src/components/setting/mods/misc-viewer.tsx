import {
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/notice-service";

export const MiscViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    appLogLevel: "warn",
    appLogMaxSize: 8,
    appLogMaxCount: 12,
    autoCloseConnection: true,
    autoCheckUpdate: true,
    enableBuiltinEnhanced: true,
    proxyLayoutColumn: 6,
    enableAutoDelayDetection: false,
    defaultLatencyTest: "",
    autoLogClean: 2,
    defaultLatencyTimeout: 10000,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        appLogLevel: verge?.app_log_level ?? "warn",
        appLogMaxSize: verge?.app_log_max_size ?? 128,
        appLogMaxCount: verge?.app_log_max_count ?? 8,
        autoCloseConnection: verge?.auto_close_connection ?? true,
        autoCheckUpdate: verge?.auto_check_update ?? true,
        enableBuiltinEnhanced: verge?.enable_builtin_enhanced ?? true,
        proxyLayoutColumn: verge?.proxy_layout_column || 6,
        enableAutoDelayDetection: verge?.enable_auto_delay_detection ?? false,
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
        app_log_max_size: values.appLogMaxSize,
        app_log_max_count: values.appLogMaxCount,
        auto_close_connection: values.autoCloseConnection,
        auto_check_update: values.autoCheckUpdate,
        enable_builtin_enhanced: values.enableBuiltinEnhanced,
        proxy_layout_column: values.proxyLayoutColumn,
        enable_auto_delay_detection: values.enableAutoDelayDetection,
        default_latency_test: values.defaultLatencyTest,
        default_latency_timeout: values.defaultLatencyTimeout,
        auto_log_clean: values.autoLogClean as any,
      });
      setOpen(false);
    } catch (err) {
      showNotice.error(err);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.misc.title")}
      contentSx={{ width: 450 }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.appLogLevel")}
          />
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
            primary={t("settings.modals.misc.fields.appLogMaxSize")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 140, marginLeft: "auto" }}
            value={values.appLogMaxSize}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                appLogMaxSize: Math.max(1, parseInt(e.target.value) || 128),
              }))
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t("shared.units.kilobytes")}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.appLogMaxCount")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 140, marginLeft: "auto" }}
            value={values.appLogMaxCount}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                appLogMaxCount: Math.max(1, parseInt(e.target.value) || 1),
              }))
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t("shared.units.files")}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.autoCloseConnections")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("settings.modals.misc.tooltips.autoCloseConnections")}
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
          <ListItemText
            primary={t("settings.modals.misc.fields.autoCheckUpdate")}
          />
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
            primary={t("settings.modals.misc.fields.enableBuiltinEnhanced")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("settings.modals.misc.tooltips.enableBuiltinEnhanced")}
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
          <ListItemText
            primary={t("settings.modals.misc.fields.proxyLayoutColumns")}
          />
          <Select
            size="small"
            sx={{ width: 160, "> div": { py: "7.5px" } }}
            value={values.proxyLayoutColumn}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                proxyLayoutColumn: e.target.value as number,
              }))
            }
          >
            <MenuItem value={6} key={6}>
              {t("settings.modals.misc.options.proxyLayoutColumns.auto")}
            </MenuItem>
            {[1, 2, 3, 4, 5].map((i) => (
              <MenuItem value={i} key={i}>
                {i}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.autoLogClean")}
          />
          <Select
            size="small"
            sx={{ width: 160, "> div": { py: "7.5px" } }}
            value={values.autoLogClean}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                autoLogClean: e.target.value as number,
              }))
            }
          >
            {/* 1: 1天, 2: 7天, 3: 30天, 4: 90天*/}
            {[
              {
                key: t("settings.modals.misc.options.autoLogClean.never"),
                value: 0,
              },
              {
                key: t("settings.modals.misc.options.autoLogClean.retainDays", {
                  n: 1,
                }),
                value: 1,
              },
              {
                key: t("settings.modals.misc.options.autoLogClean.retainDays", {
                  n: 7,
                }),
                value: 2,
              },
              {
                key: t("settings.modals.misc.options.autoLogClean.retainDays", {
                  n: 30,
                }),
                value: 3,
              },
              {
                key: t("settings.modals.misc.options.autoLogClean.retainDays", {
                  n: 90,
                }),
                value: 4,
              },
            ].map((i) => (
              <MenuItem key={i.value} value={i.value}>
                {i.key}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.autoDelayDetection")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("settings.modals.misc.tooltips.autoDelayDetection")}
            sx={{ opacity: "0.7" }}
          />
          <Switch
            edge="end"
            checked={values.enableAutoDelayDetection}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, enableAutoDelayDetection: c }))
            }
            sx={{ marginLeft: "auto" }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.defaultLatencyTest")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("settings.modals.misc.tooltips.defaultLatencyTest")}
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
            placeholder="https://cp.cloudflare.com/generate_204"
            onChange={(e) =>
              setValues((v) => ({ ...v, defaultLatencyTest: e.target.value }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.misc.fields.defaultLatencyTimeout")}
          />
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
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t("shared.units.milliseconds")}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
