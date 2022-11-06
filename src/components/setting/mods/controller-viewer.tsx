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
  List,
  ListItem,
  ListItemText,
  TextField,
} from "@mui/material";
import { getClashInfo, patchClashConfig } from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import { getAxios } from "@/services/api";
import Notice from "@/components/base/base-notice";

interface Props {
  handler: ModalHandler;
}

const ControllerViewer = ({ handler }: Props) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { data: clashInfo, mutate } = useSWR("getClashInfo", getClashInfo);
  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");

  if (handler) {
    handler.current = {
      open: () => {
        setOpen(true);
        setController(clashInfo?.server || "");
        setSecret(clashInfo?.secret || "");
      },
      close: () => setOpen(false),
    };
  }

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
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle>{t("Clash Port")}</DialogTitle>

      <DialogContent sx={{ width: 400 }}>
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
              placeholder="Recommanded"
              onChange={(e) => setSecret(e.target.value)}
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

export default ControllerViewer;
