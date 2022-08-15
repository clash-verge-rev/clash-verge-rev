import useSWR from "swr";
import { useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import {
  getClashInfo,
  getVergeConfig,
  openWebUrl,
  patchVergeConfig,
} from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import BaseEmpty from "@/components/base/base-empty";
import WebUIItem from "./web-ui-item";

interface Props {
  handler: ModalHandler;
  onError: (err: Error) => void;
}

const WebUIViewer = ({ handler, onError }: Props) => {
  const { t } = useTranslation();
  const { data: vergeConfig, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    getVergeConfig
  );

  const webUIList = vergeConfig?.web_ui_list || [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  const handleAdd = useLockFn(async (value: string) => {
    const newList = [value, ...webUIList];
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false);
    await patchVergeConfig({ web_ui_list: newList });
    await mutateVerge();
  });

  const handleChange = useLockFn(async (index: number, value?: string) => {
    const newList = [...webUIList];
    newList[index] = value ?? "";
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false);
    await patchVergeConfig({ web_ui_list: newList });
    await mutateVerge();
  });

  const handleDelete = useLockFn(async (index: number) => {
    const newList = [...webUIList];
    newList.splice(index, 1);
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false);
    await patchVergeConfig({ web_ui_list: newList });
    await mutateVerge();
  });

  const { data: clashInfo } = useSWR("getClashInfo", getClashInfo);

  const handleOpenUrl = useLockFn(async (value?: string) => {
    if (!value) return;
    try {
      let url = value.trim().replaceAll("%host", "127.0.0.1");

      if (url.includes("%port") || url.includes("%secret")) {
        if (!clashInfo) throw new Error("failed to get clash info");
        if (!clashInfo.server?.includes(":")) {
          throw new Error(
            `failed to parse server with status ${clashInfo.status}`
          );
        }

        const port = clashInfo.server
          .slice(clashInfo.server.indexOf(":") + 1)
          .trim();

        url = url.replaceAll("%port", port || "9090");
        url = url.replaceAll("%secret", clashInfo.secret || "");
      }

      await openWebUrl(url);
    } catch (e: any) {
      onError(e);
    }
  });

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle display="flex" justifyContent="space-between">
        {t("Web UI")}
        <Button
          variant="contained"
          size="small"
          disabled={editing}
          onClick={() => setEditing(true)}
        >
          {t("New")}
        </Button>
      </DialogTitle>

      <DialogContent
        sx={{
          width: 450,
          height: 300,
          pb: 1,
          overflowY: "auto",
          userSelect: "text",
        }}
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
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={() => setOpen(false)}>
          {t("Back")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default WebUIViewer;
