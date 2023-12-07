import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Button, Box, Typography } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { openWebUrl } from "@/services/cmds";
import { BaseDialog, BaseEmpty, DialogRef, Notice } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { WebUIItem } from "./web-ui-item";

export const WebUIViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { clashInfo } = useClashInfo();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const webUIList = verge?.web_ui_list || [];

  const handleAdd = useLockFn(async (value: string) => {
    const newList = [value, ...webUIList];
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false);
    await patchVerge({ web_ui_list: newList });
  });

  const handleChange = useLockFn(async (index: number, value?: string) => {
    const newList = [...webUIList];
    newList[index] = value ?? "";
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false);
    await patchVerge({ web_ui_list: newList });
  });

  const handleDelete = useLockFn(async (index: number) => {
    const newList = [...webUIList];
    newList.splice(index, 1);
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false);
    await patchVerge({ web_ui_list: newList });
  });

  const handleOpenUrl = useLockFn(async (value?: string) => {
    if (!value) return;
    try {
      let url = value.trim().replaceAll("%host", "127.0.0.1");

      if (url.includes("%port") || url.includes("%secret")) {
        if (!clashInfo) throw new Error("failed to get clash info");
        if (!clashInfo.server?.includes(":")) {
          throw new Error(`failed to parse the server "${clashInfo.server}"`);
        }

        const port = clashInfo.server
          .slice(clashInfo.server.indexOf(":") + 1)
          .trim();

        url = url.replaceAll("%port", port || "9090");
        url = url.replaceAll(
          "%secret",
          encodeURIComponent(clashInfo.secret || "")
        );
      }

      await openWebUrl(url);
    } catch (e: any) {
      Notice.error(e.message || e.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("Web UI")}
          <Button
            variant="contained"
            size="small"
            disabled={editing}
            onClick={() => setEditing(true)}
          >
            {t("New")}
          </Button>
        </Box>
      }
      contentSx={{
        width: 450,
        height: 300,
        pb: 1,
        overflowY: "auto",
        userSelect: "text",
      }}
      cancelBtn={t("Back")}
      disableOk
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      {editing && (
        <WebUIItem
          value=""
          onlyEdit
          onChange={(v) => {
            setEditing(false);
            handleAdd(v || "");
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {!editing && webUIList.length === 0 && (
        <BaseEmpty
          text="Empty List"
          extra={
            <Typography mt={2} sx={{ fontSize: "12px" }}>
              Replace host, port, secret with "%host" "%port" "%secret"
            </Typography>
          }
        />
      )}

      {webUIList.map((item, index) => (
        <WebUIItem
          key={index}
          value={item}
          onChange={(v) => handleChange(index, v)}
          onDelete={() => handleDelete(index)}
          onOpenUrl={handleOpenUrl}
        />
      ))}
    </BaseDialog>
  );
});
