import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { checkPortAvailable } from "@/services/cmds";
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
  const [redirPort, setRedirPort] = useState(clashInfo?.redir_port ?? 0);
  const [tproxyPort, setTproxyPort] = useState(clashInfo?.tproxy_port ?? 0);
  const [mixedPort, setMixedPort] = useState(clashInfo?.mixed_port ?? 7890);
  const [socksPort, setSocksPort] = useState(clashInfo?.socks_port ?? 0);
  const [port, setPort] = useState(clashInfo?.port ?? 0);

  useImperativeHandle(ref, () => ({
    open: () => {
      setRedirPort(clashInfo?.redir_port ?? 0);
      setTproxyPort(clashInfo?.tproxy_port ?? 0);
      setMixedPort(clashInfo?.mixed_port ?? 7890);
      setSocksPort(clashInfo?.socks_port ?? 0);
      setPort(clashInfo?.port ?? 0);
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
      const updatePorts: Record<string, number> = {};
      if (OS !== "windows") {
        const res = await checkPortAvailable(redirPort);
        if (!res) {
          Notice.error(t("Port Conflict", { portName: "redir port" }), 4000);
          return;
        }
        updatePorts["redir-port"] = redirPort;
      }
      if (OS === "linux") {
        const res = await checkPortAvailable(tproxyPort);
        if (!res) {
          Notice.error(t("Port Conflict", { portName: "tproxy port" }), 4000);
          return;
        }
        updatePorts["tproxy-port"] = tproxyPort;
      }
      let res = await checkPortAvailable(mixedPort);
      if (!res) {
        Notice.error(t("Port Conflict", { portName: "mixed port" }), 4000);
        return;
      }
      updatePorts["mixed-port"] = mixedPort;
      res = await checkPortAvailable(socksPort);
      if (!res) {
        Notice.error(t("Port Conflict", { portName: "socks port" }), 4000);
        return;
      }
      updatePorts["socks-port"] = socksPort;
      res = await checkPortAvailable(port);
      if (!res) {
        Notice.error(t("Port Conflict", { portName: "port" }), 4000);
        return;
      }
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
      contentStyle={{ width: 300 }}
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
