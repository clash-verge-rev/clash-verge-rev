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
} from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { getSystemProxy } from "@/services/cmds";
import { BaseDialog, DialogRef, Notice } from "@/components/base";

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
  } = verge ?? {};

  const [value, setValue] = useState({
    guard: enable_proxy_guard,
    bypass: system_proxy_bypass,
    duration: proxy_guard_duration ?? 10,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValue({
        guard: enable_proxy_guard,
        bypass: system_proxy_bypass,
        duration: proxy_guard_duration ?? 10,
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
      contentSx={{ width: 450, maxHeight: 300 }}
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
      </List>

      <Box sx={{ mt: 2.5 }}>
        <Typography variant="body1" sx={{ fontSize: "18px", mb: 1 }}>
          {t("Current System Proxy")}
        </Typography>

        <FlexBox>
          <Typography className="label">Enable:</Typography>
          <Typography className="value">
            {(!!sysproxy?.enable).toString()}
          </Typography>
        </FlexBox>

        <FlexBox>
          <Typography className="label">Server:</Typography>
          <Typography className="value">{sysproxy?.server || "-"}</Typography>
        </FlexBox>

        <FlexBox>
          <Typography className="label">Bypass:</Typography>
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
    width: 80px;
  }
`;
