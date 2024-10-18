import { BaseDialog, DialogRef, Notice, SwitchLovely } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import getSystem from "@/utils/get-system";
import {
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { StackModeSwitch } from "./stack-mode-switch";

const OS = getSystem();

export const TunViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { clash, mutateClash, patchClash } = useClash();
  const [open, setOpen] = useState(false);
  const isMacos = OS === "macos";
  const defaultDeviceName = isMacos ? "utun_Mihomo" : "Mihomo";
  const [values, setValues] = useState({
    stack: "gvisor",
    device: defaultDeviceName,
    autoRoute: true,
    autoDetectInterface: true,
    dnsHijack: ["any:53"],
    strictRoute: false,
    mtu: 9000,
  });
  const [isLoading, setLoading] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        stack: clash?.tun.stack ?? "gvisor",
        device: clash?.tun.device ?? defaultDeviceName,
        autoRoute: clash?.tun["auto-route"] ?? true,
        autoDetectInterface: clash?.tun["auto-detect-interface"] ?? true,
        dnsHijack: clash?.tun["dns-hijack"] ?? ["any:53"],
        strictRoute: clash?.tun["strict-route"] ?? false,
        mtu: clash?.tun.mtu ?? 9000,
      });
    },
    close: () => setOpen(false),
  }));

  const doSave = async (retry = 5) => {
    setLoading(true);
    const tun = {
      stack: values.stack,
      device: values.device === "" ? defaultDeviceName : values.device,
      "auto-route": values.autoRoute,
      "auto-detect-interface": values.autoDetectInterface,
      "dns-hijack": values.dnsHijack[0] === "" ? [] : values.dnsHijack,
      "strict-route": values.strictRoute,
      mtu: values.mtu ?? 9000,
    };
    try {
      await patchClash({ tun });
      await mutateClash(
        (old) => ({ ...(old! || {}), tun: { ...old?.tun, ...tun } }),
        false,
      );
      setLoading(false);
      setOpen(false);
      Notice.success(t("Clash Config Updated"));
    } catch (err: any) {
      if (retry < 0) {
        await patchClash({ tun: { enable: false } });
        await mutateClash(
          (old) => ({
            ...(old! || {}),
            tun: { ...old?.tun, ...tun, enable: false },
          }),
          false,
        );
        setLoading(false);
        setOpen(false);
        Notice.error(t(err));
      } else {
        setTimeout(() => doSave(retry - 1), 1000);
      }
    }
  };

  const onSave = useLockFn(async () => {
    if (isMacos && !values.device.startsWith("utun")) {
      Notice.error(t("Macos Device Name Error"), 3000);
      return;
    }
    doSave();
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between" gap={1}>
          <Typography variant="h6">{t("Tun Mode")}</Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={async () => {
              setValues({
                stack: "gvisor",
                device: defaultDeviceName,
                autoRoute: true,
                autoDetectInterface: true,
                dnsHijack: ["any:53"],
                strictRoute: false,
                mtu: 9000,
              });
            }}>
            {t("Reset to Default")}
          </Button>
        </Box>
      }
      loading={isLoading}
      contentStyle={{ width: 450 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}>
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Stack")} />
          <StackModeSwitch
            value={values.stack}
            onChange={(value) => {
              setValues((v) => ({ ...v, stack: value }));
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
            placeholder="Mihomo"
            onChange={(e) =>
              setValues((v) => ({ ...v, device: e.target.value }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Route")} />
          <SwitchLovely
            edge="end"
            checked={values.autoRoute}
            onChange={(_, c) => setValues((v) => ({ ...v, autoRoute: c }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Strict Route")} />
          <SwitchLovely
            edge="end"
            checked={values.strictRoute}
            onChange={(_, c) => setValues((v) => ({ ...v, strictRoute: c }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Auto Detect Interface")} />
          <SwitchLovely
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
              setValues((v) => ({ ...v, mtu: parseInt(e.target.value) }))
            }
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
