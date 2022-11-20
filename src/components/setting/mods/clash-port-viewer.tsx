import useSWR from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useSetRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { List, ListItem, ListItemText, TextField } from "@mui/material";
import { atomClashPort } from "@/services/states";
import { getClashConfig } from "@/services/api";
import { patchClashConfig } from "@/services/cmds";
import { BaseDialog, DialogRef } from "@/components/base";
import Notice from "@/components/base/base-notice";

export const ClashPortViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { data: config, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig
  );

  const [open, setOpen] = useState(false);
  const [port, setPort] = useState(config?.["mixed-port"] ?? 9090);

  const setGlobalClashPort = useSetRecoilState(atomClashPort);

  useImperativeHandle(ref, () => ({
    open: () => {
      if (config?.["mixed-port"]) {
        setPort(config["mixed-port"]);
      }
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    if (port < 1000) {
      return Notice.error("The port should not < 1000");
    }
    if (port > 65536) {
      return Notice.error("The port should not > 65536");
    }

    setOpen(false);
    if (port === config?.["mixed-port"]) return;

    try {
      await patchClashConfig({ "mixed-port": port });
      setGlobalClashPort(port);
      Notice.success("Change Clash port successfully!", 1000);
      mutateClash();
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 5000);
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
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary="Mixed Port" />
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
