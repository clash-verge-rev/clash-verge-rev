import useSWR from "swr";
import { useEffect, useState } from "react";
import { useSetRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
} from "@mui/material";
import { atomClashPort } from "@/services/states";
import { getClashConfig } from "@/services/api";
import { patchClashConfig } from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import Notice from "@/components/base/base-notice";

interface Props {
  handler: ModalHandler;
}

const ClashPortViewer = ({ handler }: Props) => {
  const { t } = useTranslation();

  const { data: config, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig
  );

  const [open, setOpen] = useState(false);
  const [port, setPort] = useState(config?.["mixed-port"] ?? 9090);

  const setGlobalClashPort = useSetRecoilState(atomClashPort);

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  useEffect(() => {
    if (open && config?.["mixed-port"]) {
      setPort(config["mixed-port"]);
    }
  }, [open, config?.["mixed-port"]]);

  const onSave = useLockFn(async () => {
    if (port < 1000) {
      return Notice.error("The port should not < 1000");
    }
    if (port > 65536) {
      return Notice.error("The port should not > 65536");
    }

    setOpen(false);
    if (port === config?.["mixed-port"]) return;

    await patchClashConfig({ "mixed-port": port });
    setGlobalClashPort(port);
    Notice.success("Change Clash port successfully!", 1000);
    mutateClash();
  });

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle>{t("Clash Port")}</DialogTitle>

      <DialogContent sx={{ width: 300 }}>
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
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </Button>
        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ClashPortViewer;
