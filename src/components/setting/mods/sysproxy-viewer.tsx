import useSWR from "swr";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  styled,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  getSystemProxy,
  getVergeConfig,
  patchVergeConfig,
} from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import Notice from "@/components/base/base-notice";

interface Props {
  handler: ModalHandler;
}

const FlexBox = styled("div")`
  display: flex;
  margin-top: 4px;

  .label {
    flex: none;
    width: 80px;
  }
`;

const SysproxyViewer = ({ handler }: Props) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  const { data: vergeConfig, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    getVergeConfig
  );

  const {
    enable_system_proxy: enabled,
    enable_proxy_guard,
    system_proxy_bypass,
    proxy_guard_duration,
  } = vergeConfig ?? {};

  const { data: sysproxy } = useSWR(
    open ? "getSystemProxy" : null,
    getSystemProxy
  );

  const [value, setValue] = useState({
    guard: enable_proxy_guard,
    bypass: system_proxy_bypass,
    duration: proxy_guard_duration ?? 10,
  });

  useEffect(() => {
    setValue({
      guard: enable_proxy_guard,
      bypass: system_proxy_bypass,
      duration: proxy_guard_duration ?? 10,
    });
  }, [vergeConfig]);

  const onSave = useLockFn(async () => {
    if (value.duration < 5) {
      Notice.error("Proxy guard duration at least 5 seconds");
      return;
    }

    const patch: Partial<CmdType.VergeConfig> = {};

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
      await patchVergeConfig(patch);
      mutateVerge();
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle>{t("System Proxy Setting")}</DialogTitle>

      <DialogContent sx={{ width: 450, maxHeight: 300 }}>
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
            <ListItemText
              primary={t("Proxy Bypass")}
              sx={{ padding: "3px 0" }}
            />
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

export default SysproxyViewer;
