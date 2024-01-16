import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Box,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  styled,
  Switch,
  TextField,
  Typography,
  Tooltip,
} from "@mui/material";
import getSystem from "@/utils/get-system";
import { useVerge } from "@/hooks/use-verge";
import { getSystemProxy } from "@/services/cmds";
import { BaseDialog, DialogRef, Notice } from "@/components/base";

const OS = getSystem();

export const SysproxyViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  const { verge, patchVerge } = useVerge();

  type SysProxy = Awaited<ReturnType<typeof getSystemProxy>>;
  const [sysproxy, setSysproxy] = useState<SysProxy>();

  const {
    enable_system_proxy: enabled,
    enable_proxy_guard,
    system_proxy_bypass,
    proxy_guard_duration,
    system_proxy_registry_mode,
  } = verge ?? {};

  const [value, setValue] = useState({
    guard: enable_proxy_guard,
    bypass: system_proxy_bypass,
    duration: proxy_guard_duration ?? 10,
    registryMode: system_proxy_registry_mode,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValue({
        guard: enable_proxy_guard,
        bypass: system_proxy_bypass,
        duration: proxy_guard_duration ?? 10,
        registryMode: system_proxy_registry_mode,
      });
      getSystemProxy().then((p) => setSysproxy(p));
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    if (value.duration < 1) {
      Notice.error("Proxy guard duration at least 1 seconds");
      return;
    }

    const patch: Partial<IVergeConfig> = {};

    if (value.guard !== enable_proxy_guard) {
      patch.enable_proxy_guard = value.guard;
    }
    if (value.duration !== proxy_guard_duration) {
      patch.proxy_guard_duration = value.duration;
    }
    if (value.bypass !== system_proxy_bypass) {
      patch.system_proxy_bypass = value.bypass;
    }
    if (value.registryMode !== system_proxy_registry_mode) {
      patch.system_proxy_registry_mode = value.registryMode;
    }

    try {
      await patchVerge(patch);
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("System Proxy Setting")}
      contentSx={{ width: 450, maxHeight: 500 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Proxy Guard")} />
          <Switch
            edge="end"
            disabled={!enabled}
            checked={value.guard}
            onChange={(_, e) => setValue((v) => ({ ...v, guard: e }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Guard Duration")} />
          <TextField
            disabled={!enabled}
            size="small"
            value={value.duration}
            sx={{ width: 100 }}
            InputProps={{
              endAdornment: <InputAdornment position="end">s</InputAdornment>,
            }}
            onChange={(e) => {
              setValue((v) => ({
                ...v,
                duration: +e.target.value.replace(/\D/, ""),
              }));
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px", alignItems: "start" }}>
          <ListItemText primary={t("Proxy Bypass")} sx={{ padding: "3px 0" }} />
          <TextField
            disabled={!enabled}
            size="small"
            autoComplete="off"
            multiline
            rows={3}
            sx={{ width: 280 }}
            value={value.bypass}
            onChange={(e) =>
              setValue((v) => ({ ...v, bypass: e.target.value }))
            }
          />
        </ListItem>
        {OS === "windows" && (
          <Tooltip
            title={
              enabled
                ? t("Please disable the system proxy")
                : t("Using the registry instead of Windows API")
            }
          >
            <ListItem sx={{ padding: "5px 2px" }}>
              <ListItemText primary={t("Use Registry")} />
              <Switch
                edge="end"
                disabled={enabled}
                checked={value.registryMode}
                onChange={(_, e) =>
                  setValue((v) => ({ ...v, registryMode: e }))
                }
              />
            </ListItem>
          </Tooltip>
        )}
      </List>

      <Box sx={{ mt: 2.5 }}>
        <Typography variant="body1" sx={{ fontSize: "18px", mb: 1 }}>
          {t("Current System Proxy")}
        </Typography>

        <FlexBox>
          <Typography className="label">{t("Enable status")}</Typography>
          <Typography className="value">
            {(!!sysproxy?.enable).toString()}
          </Typography>
        </FlexBox>

        <FlexBox>
          <Typography className="label">{t("Server Addr")}</Typography>
          <Typography className="value">{sysproxy?.server || "-"}</Typography>
        </FlexBox>

        <FlexBox>
          <Typography className="label">{t("Bypass")}</Typography>
          <Typography className="value">{sysproxy?.bypass || "-"}</Typography>
        </FlexBox>
      </Box>
    </BaseDialog>
  );
});

const FlexBox = styled("div")`
  display: flex;
  margin-top: 4px;

  .label {
    flex: none;
    width: 85px;
  }
`;
