import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import getSystem from "@/utils/get-system";
import { List, ListItem, ListItemText, TextField } from "@mui/material";
import { useLockFn } from "ahooks";
import { uniq } from "lodash-es";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";

const OS = getSystem();

export const ClashPortViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { clashInfo, patchInfo } = useClashInfo();

  const [open, setOpen] = useState(false);
  const [redirPort, setRedirPort] = useState(clashInfo?.redir_port ?? 7895);
  const [tproxyPort, setTproxyPort] = useState(clashInfo?.tproxy_port ?? 7896);
  const [mixedPort, setMixedPort] = useState(clashInfo?.mixed_port ?? 7897);
  const [socksPort, setSocksPort] = useState(clashInfo?.socks_port ?? 7898);
  const [port, setPort] = useState(clashInfo?.port ?? 7899);

  useImperativeHandle(ref, () => ({
    open: () => {
      setRedirPort(clashInfo?.redir_port ?? 7895);
      setTproxyPort(clashInfo?.tproxy_port ?? 7896);
      setMixedPort(clashInfo?.mixed_port ?? 7897);
      setSocksPort(clashInfo?.socks_port ?? 7898);
      setPort(clashInfo?.port ?? 7899);
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    if (
      redirPort === clashInfo?.redir_port &&
      tproxyPort === clashInfo?.tproxy_port &&
      mixedPort === clashInfo?.mixed_port &&
      socksPort === clashInfo?.socks_port &&
      port === clashInfo?.port
    ) {
      setOpen(false);
      return;
    }

    if (OS === "linux") {
      const conflictPorts = [
        redirPort,
        tproxyPort,
        mixedPort,
        socksPort,
        port,
      ].filter((port) => port !== 0);
      if (uniq(conflictPorts).length !== conflictPorts.length) {
        Notice.error(t("Port Conflict"), 4000);
        return;
      }
    }
    if (OS === "macos") {
      const conflictPorts = [redirPort, mixedPort, socksPort, port].filter(
        (port) => port !== 0,
      );
      if (uniq(conflictPorts).length !== conflictPorts.length) {
        Notice.error(t("Port Conflict"), 4000);
        return;
      }
    }
    if (OS === "windows") {
      const conflictPorts = [mixedPort, socksPort, port].filter(
        (port) => port !== 0,
      );
      if (uniq(conflictPorts).length !== conflictPorts.length) {
        Notice.error(t("Port Conflict"), 4000);
        return;
      }
    }

    try {
      let updatePorts: Record<string, number> = {};
      if (OS !== "windows") {
        updatePorts["redir-port"] = redirPort;
      }
      if (OS === "linux") {
        updatePorts["tproxy-port"] = tproxyPort;
      }
      updatePorts["mixed-port"] = mixedPort;
      updatePorts["socks-port"] = socksPort;
      updatePorts["port"] = port;
      await patchInfo(updatePorts);
      await mutate("getRuntimeConfig");
      setOpen(false);
      Notice.success(t("Clash Port Modified"), 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 4000);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Clash Port")}
      contentSx={{ width: 300 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}>
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary="Mixed Port"
            sx={{ opacity: mixedPort === 0 ? 0.5 : 1 }}
          />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 135, opacity: mixedPort === 0 ? 0.5 : 1 }}
            value={mixedPort}
            onChange={(e) =>
              setMixedPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
            }
          />
        </ListItem>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary="Socks Port"
            sx={{ opacity: socksPort === 0 ? 0.5 : 1 }}
          />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 135, opacity: socksPort === 0 ? 0.5 : 1 }}
            value={socksPort}
            onChange={(e) =>
              setSocksPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
            }
          />
        </ListItem>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary="Http Port"
            sx={{ opacity: port === 0 ? 0.5 : 1 }}
          />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 135, opacity: port === 0 ? 0.5 : 1 }}
            value={port}
            onChange={(e) =>
              setPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
            }
          />
        </ListItem>
        {OS !== "windows" && (
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText
              primary="Redir Port"
              sx={{ opacity: redirPort === 0 ? 0.5 : 1 }}
            />
            <TextField
              size="small"
              autoComplete="off"
              sx={{ width: 135, opacity: redirPort === 0 ? 0.5 : 1 }}
              value={redirPort}
              onChange={(e) =>
                setRedirPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
            />
          </ListItem>
        )}
        {OS === "linux" && (
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText
              primary="Tproxy Port"
              sx={{ opacity: tproxyPort === 0 ? 0.5 : 1 }}
            />
            <TextField
              size="small"
              autoComplete="off"
              sx={{ width: 135, opacity: tproxyPort === 0 ? 0.5 : 1 }}
              value={tproxyPort}
              onChange={(e) =>
                setTproxyPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
            />
          </ListItem>
        )}
      </List>
    </BaseDialog>
  );
});
