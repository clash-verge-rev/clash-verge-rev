import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { List, ListItem, ListItemText, TextField } from "@mui/material";
import { useClashInfo } from "@/hooks/use-clash";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import getSystem from "@/utils/get-system";
const OS = getSystem();

export const ClashPortViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { clashInfo, patchInfo } = useClashInfo();
  const { verge, patchVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [redirPort, setRedirPort] = useState(
    verge?.verge_redir_port ?? clashInfo?.redir_port ?? 7895
  );
  const [tproxyPort, setTproxyPort] = useState(
    verge?.verge_tproxy_port ?? clashInfo?.tproxy_port ?? 7896
  );
  const [mixedPort, setMixedPort] = useState(
    verge?.verge_mixed_port ?? clashInfo?.mixed_port ?? 7897
  );
  const [socksPort, setSocksPort] = useState(
    verge?.verge_socks_port ?? clashInfo?.socks_port ?? 7898
  );
  const [port, setPort] = useState(
    verge?.verge_port ?? clashInfo?.port ?? 7899
  );

  useImperativeHandle(ref, () => ({
    open: () => {
      if (verge?.verge_redir_port) setRedirPort(verge?.verge_redir_port);
      if (verge?.verge_tproxy_port) setTproxyPort(verge?.verge_tproxy_port);
      if (verge?.verge_mixed_port) setMixedPort(verge?.verge_mixed_port);
      if (verge?.verge_socks_port) setSocksPort(verge?.verge_socks_port);
      if (verge?.verge_port) setPort(verge?.verge_port);
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    if (
      redirPort === verge?.verge_redir_port &&
      tproxyPort === verge?.verge_tproxy_port &&
      mixedPort === verge?.verge_mixed_port &&
      socksPort === verge?.verge_socks_port &&
      port === verge?.verge_port
    ) {
      setOpen(false);
      return;
    }

    if (
      OS === "linux" &&
      new Set([redirPort, tproxyPort, mixedPort, socksPort, port]).size !== 5
    ) {
      Notice.error("Port conflict!", 4000);
      return;
    }
    if (
      OS === "macos" &&
      new Set([redirPort, mixedPort, socksPort, port]).size !== 4
    ) {
      Notice.error("Port conflict!", 4000);
      return;
    }
    if (OS === "windows" && new Set([mixedPort, socksPort, port]).size !== 3) {
      Notice.error("Port conflict!", 4000);
      return;
    }
    try {
      if (OS !== "windows") {
        await patchInfo({ "redir-port": redirPort });
        await patchVerge({ verge_redir_port: redirPort });
      }
      if (OS === "linux") {
        await patchInfo({ "tproxy-port": tproxyPort });
        await patchVerge({ verge_tproxy_port: tproxyPort });
      }
      await patchInfo({ "mixed-port": mixedPort });
      await patchInfo({ "socks-port": socksPort });
      await patchInfo({ port });
      await patchVerge({ verge_mixed_port: mixedPort });
      await patchVerge({ verge_socks_port: socksPort });
      await patchVerge({ verge_port: port });
      setOpen(false);
      Notice.success("Change Clash port successfully!", 1000);
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
      onOk={onSave}
    >
      <List>
        {OS !== "windows" && (
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText primary="Redir Port" />
            <TextField
              size="small"
              autoComplete="off"
              sx={{ width: 135 }}
              value={redirPort}
              onChange={(e) =>
                setRedirPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
            />
          </ListItem>
        )}
        {OS === "linux" && (
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText primary="Tproxy Port" />
            <TextField
              size="small"
              autoComplete="off"
              sx={{ width: 135 }}
              value={tproxyPort}
              onChange={(e) =>
                setTproxyPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
            />
          </ListItem>
        )}

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary="Mixed Port" />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 135 }}
            value={mixedPort}
            onChange={(e) =>
              setMixedPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
            }
          />
        </ListItem>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary="Socks Port" />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 135 }}
            value={socksPort}
            onChange={(e) =>
              setSocksPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
            }
          />
        </ListItem>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary="Http Port" />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 135 }}
            value={port}
            onChange={(e) =>
              setPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
            }
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
