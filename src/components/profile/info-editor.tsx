import { mutate } from "swr";
import { useEffect, useState } from "react";
import { useLockFn, useSetState } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";
import { Settings } from "@mui/icons-material";
import { patchProfile } from "@/services/cmds";
import Notice from "../base/base-notice";

interface Props {
  open: boolean;
  itemData: CmdType.ProfileItem;
  onClose: () => void;
}

// edit the profile item
// remote / local file / merge / script
const InfoEditor = (props: Props) => {
  const { open, itemData, onClose } = props;

  const { t } = useTranslation();
  const [form, setForm] = useSetState({ ...itemData });
  const [option, setOption] = useSetState(itemData.option ?? {});
  const [showOpt, setShowOpt] = useState(!!itemData.option);

  useEffect(() => {
    if (itemData) {
      setForm({ ...itemData });
      setOption(itemData.option ?? {});
      setShowOpt(
        itemData.type === "remote" &&
          (!!itemData.option?.user_agent || !!itemData.option?.update_interval)
      );
    }
  }, [itemData]);

  const onUpdate = useLockFn(async () => {
    try {
      const { uid } = itemData;
      const { name, desc, url } = form;
      const option_ =
        itemData.type === "remote" || itemData.type === "local"
          ? option
          : undefined;

      if (itemData.type === "remote" && !url) {
        throw new Error("Remote URL should not be null");
      }

      await patchProfile(uid, { uid, name, desc, url, option: option_ });
      mutate("getProfiles");
      onClose();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const textFieldProps = {
    fullWidth: true,
    size: "small",
    margin: "normal",
    variant: "outlined",
  } as const;

  const type =
    form.type ||
    (form.url ? "remote" : form.file?.endsWith(".js") ? "script" : "local");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle sx={{ pb: 0.5 }}>{t("Edit Info")}</DialogTitle>

      <DialogContent sx={{ width: 336, pb: 1 }}>
        <TextField
          {...textFieldProps}
          disabled
          label="Type"
          value={type}
          sx={{ input: { textTransform: "capitalize" } }}
        />

        <TextField
          {...textFieldProps}
          autoFocus
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onUpdate()}
        />

        <TextField
          {...textFieldProps}
          label="Descriptions"
          value={form.desc}
          onChange={(e) => setForm({ desc: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onUpdate()}
        />

        {type === "remote" && (
          <TextField
            {...textFieldProps}
            label="Subscription URL"
            value={form.url}
            onChange={(e) => setForm({ url: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onUpdate()}
          />
        )}

        {showOpt && (
          <TextField
            {...textFieldProps}
            label="User Agent"
            value={option.user_agent}
            placeholder="clash-verge/v1.0.0"
            onChange={(e) => setOption({ user_agent: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onUpdate()}
          />
        )}

        {((type === "remote" && showOpt) || type === "local") && (
          <TextField
            {...textFieldProps}
            label="Update Interval (mins)"
            value={option.update_interval}
            onChange={(e) => {
              const str = e.target.value?.replace(/\D/, "");
              setOption({ update_interval: !!str ? +str : undefined });
            }}
            onKeyDown={(e) => e.key === "Enter" && onUpdate()}
          />
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2, position: "relative" }}>
        {form.type === "remote" && (
          <IconButton
            size="small"
            color="inherit"
            sx={{ position: "absolute", left: 18 }}
            onClick={() => setShowOpt((o) => !o)}
          >
            <Settings />
          </IconButton>
        )}

        <Button onClick={onClose} variant="outlined">
          {t("Cancel")}
        </Button>
        <Button onClick={onUpdate} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default InfoEditor;
