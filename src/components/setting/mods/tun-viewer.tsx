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
import { useClash } from "@/hooks/use-clash";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { StackModeSwitch } from "./stack-mode-switch";

export const TunViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { clash, mutateClash, patchClash } = useClash();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    stack: "gVisor",
    device: "Mihomo",
    autoRoute: true,
    autoDetectInterface: true,
    dnsHijack: ["any:53", "tcp://any:53"],
    strictRoute: false,
    mtu: 9000,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        stack: clash?.tun.stack ?? "gVisor",
        device: clash?.tun.device ?? "Mihomo",
        autoRoute: clash?.tun["auto-route"] ?? true,
        autoDetectInterface: clash?.tun["auto-detect-interface"] ?? true,
        dnsHijack: clash?.tun["dns-hijack"] ?? ["any:53", "tcp://any:53"],
        strictRoute: clash?.tun["strict-route"] ?? false,
        mtu: clash?.tun.mtu ?? 9000,
      });
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      let tun = {
        stack: values.stack,
        device: values.device,
        "auto-route": values.autoRoute,
        "auto-detect-interface": values.autoDetectInterface,
        "dns-hijack": values.dnsHijack,
        "strict-route": values.strictRoute,
        mtu: values.mtu,
      };
      await patchClash({ tun });
      await mutateClash(
        (old) => ({
          ...(old! || {}),
          tun,
        }),
        false
      );
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Tun Mode")}
      contentSx={{ width: 450 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Stack")} />
          <StackModeSwitch
            value={values.stack}
            onChange={(value) => {
              setValues((v) => ({
                ...v,
                stack: value,
              }));
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Device")} />
          <TextField
            size="small"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.device}
            placeholder="Meta"
            onChange={(e) =>
              setValues((v) => ({ ...v, device: e.target.value }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Route")} />
          <Switch
            edge="end"
            checked={values.autoRoute}
            onChange={(_, c) => setValues((v) => ({ ...v, autoRoute: c }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Strict Route")} />
          <Switch
            edge="end"
            checked={values.strictRoute}
            onChange={(_, c) => setValues((v) => ({ ...v, strictRoute: c }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Detect Interface")} />
          <Switch
            edge="end"
            checked={values.autoDetectInterface}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoDetectInterface: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("DNS Hijack")} />
          <TextField
            size="small"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.dnsHijack.join(",")}
            placeholder="Please use , to separate multiple DNS servers"
            onChange={(e) =>
              setValues((v) => ({ ...v, dnsHijack: e.target.value.split(",") }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("MTU")} />
          <TextField
            size="small"
            type="number"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.mtu}
            placeholder="9000"
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                mtu: parseInt(e.target.value),
              }))
            }
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
