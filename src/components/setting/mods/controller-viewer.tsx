import useSWR from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { List, ListItem, ListItemText, TextField } from "@mui/material";
import { getClashInfo, patchClashConfig } from "@/services/cmds";
import { getAxios } from "@/services/api";
import { BaseDialog, DialogRef } from "@/components/base";
import Notice from "@/components/base/base-notice";

export const ControllerViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { data: clashInfo, mutate } = useSWR("getClashInfo", getClashInfo);
  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setController(clashInfo?.server || "");
      setSecret(clashInfo?.secret || "");
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      await patchClashConfig({ "external-controller": controller, secret });
      mutate();
      // 刷新接口
      getAxios(true);
      Notice.success("Change Clash Config successfully!", 1000);
      setOpen(false);
    } catch (err) {
      console.log(err);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Clash Port")}
      contentSx={{ width: 400 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary="External Controller" />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 175 }}
            value={controller}
            placeholder="Required"
            onChange={(e) => setController(e.target.value)}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary="Core Secret" />
          <TextField
            size="small"
            autoComplete="off"
            sx={{ width: 175 }}
            value={secret}
            placeholder="Recommended"
            onChange={(e) => setSecret(e.target.value)}
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
