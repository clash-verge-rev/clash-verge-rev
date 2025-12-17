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
import type { Ref } from "react";
import { useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { useClash } from "@/hooks/use-clash";
import { enhanceProfiles } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import getSystem from "@/utils/get-system";

import { StackModeSwitch } from "./stack-mode-switch";

const OS = getSystem();

export function TunViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();

  const { clash, mutateClash, patchClash } = useClash();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    stack: "mixed",
    device: OS === "macos" ? "utun1024" : "Mihomo",
    autoRoute: true,
    autoRedirect: false,
    autoDetectInterface: true,
    dnsHijack: ["any:53"],
    strictRoute: false,
    mtu: 1500,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      const nextAutoRoute = clash?.tun["auto-route"] ?? true;
      const rawAutoRedirect = clash?.tun["auto-redirect"] ?? false;
      const computedAutoRedirect =
        OS === "linux" ? (nextAutoRoute ? rawAutoRedirect : false) : false;
      setValues({
        stack: clash?.tun.stack ?? "gvisor",
        device: clash?.tun.device ?? (OS === "macos" ? "utun1024" : "Mihomo"),
        autoRoute: nextAutoRoute,
        autoRedirect: computedAutoRedirect,
        autoDetectInterface: clash?.tun["auto-detect-interface"] ?? true,
        dnsHijack: clash?.tun["dns-hijack"] ?? ["any:53"],
        strictRoute: clash?.tun["strict-route"] ?? false,
        mtu: clash?.tun.mtu ?? 1500,
      });
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      const tun: IConfigData["tun"] = {
        stack: values.stack,
        device:
          values.device === ""
            ? OS === "macos"
              ? "utun1024"
              : "Mihomo"
            : values.device,
        "auto-route": values.autoRoute,
        ...(OS === "linux"
          ? {
              "auto-redirect": values.autoRedirect,
            }
          : {}),
        "auto-detect-interface": values.autoDetectInterface,
        "dns-hijack": values.dnsHijack[0] === "" ? [] : values.dnsHijack,
        "strict-route": values.strictRoute,
        mtu: values.mtu ?? 1500,
      };
      await patchClash({ tun });
      await mutateClash(
        (old) => ({
          ...old!,
          tun,
        }),
        false,
      );
      try {
        await enhanceProfiles();
        showNotice.success("settings.modals.tun.messages.applied");
      } catch (err: any) {
        showNotice.error(err);
      }
      setOpen(false);
    } catch (err: any) {
      showNotice.error(err);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between" gap={1}>
          <Typography variant="h6">{t("settings.modals.tun.title")}</Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={async () => {
              const tun: IConfigData["tun"] = {
                stack: "gvisor",
                device: OS === "macos" ? "utun1024" : "Mihomo",
                "auto-route": true,
                ...(OS === "linux"
                  ? {
                      "auto-redirect": false,
                    }
                  : {}),
                "auto-detect-interface": true,
                "dns-hijack": ["any:53"],
                "strict-route": false,
                mtu: 1500,
              };
              setValues({
                stack: "gvisor",
                device: OS === "macos" ? "utun1024" : "Mihomo",
                autoRoute: true,
                autoRedirect: false,
                autoDetectInterface: true,
                dnsHijack: ["any:53"],
                strictRoute: false,
                mtu: 1500,
              });
              await patchClash({ tun });
              await mutateClash(
                (old) => ({
                  ...old!,
                  tun,
                }),
                false,
              );
            }}
          >
            {t("shared.actions.resetToDefault")}
          </Button>
        </Box>
      }
      contentSx={{ width: 450 }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("settings.modals.tun.fields.stack")} />
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
          <ListItemText primary={t("settings.modals.tun.fields.device")} />
          <TextField
            autoComplete="new-password"
            size="small"
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
          <ListItemText primary={t("settings.modals.tun.fields.autoRoute")} />
          <Switch
            edge="end"
            checked={values.autoRoute}
            onChange={(_, c) =>
              setValues((v) => ({
                ...v,
                autoRoute: c,
                autoRedirect: c ? v.autoRedirect : false,
              }))
            }
          />
        </ListItem>

        {OS === "linux" && (
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText
              primary={t("settings.modals.tun.fields.autoRedirect")}
              sx={{ maxWidth: "fit-content" }}
            />
            <TooltipIcon
              title={t("settings.modals.tun.tooltips.autoRedirect")}
              sx={{ opacity: values.autoRoute ? 0.7 : 0.3 }}
            />
            <Switch
              edge="end"
              checked={values.autoRedirect}
              onChange={(_, c) =>
                setValues((v) => ({
                  ...v,
                  autoRedirect: v.autoRoute ? c : v.autoRedirect,
                }))
              }
              disabled={!values.autoRoute}
              sx={{ marginLeft: "auto" }}
            />
          </ListItem>
        )}

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("settings.modals.tun.fields.strictRoute")} />
          <Switch
            edge="end"
            checked={values.strictRoute}
            onChange={(_, c) => setValues((v) => ({ ...v, strictRoute: c }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.tun.fields.autoDetectInterface")}
          />
          <Switch
            edge="end"
            checked={values.autoDetectInterface}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoDetectInterface: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("settings.modals.tun.fields.dnsHijack")} />
          <TextField
            autoComplete="new-password"
            size="small"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.dnsHijack.join(",")}
            placeholder={t("settings.modals.tun.tooltips.dnsHijack")}
            onChange={(e) =>
              setValues((v) => ({ ...v, dnsHijack: e.target.value.split(",") }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("settings.modals.tun.fields.mtu")} />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.mtu}
            placeholder="1500"
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
}
