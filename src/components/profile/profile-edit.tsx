import { mutate } from "swr";
import { useEffect, useState } from "react";
import { useLockFn, useSetState } from "ahooks";
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
import { CmdType } from "../../services/types";
import { patchProfile } from "../../services/cmds";
import Notice from "../base/base-notice";

interface Props {
  open: boolean;
  itemData: CmdType.ProfileItem;
  onClose: () => void;
}

// edit the profile item
// remote / local file / merge / script
const ProfileEdit = (props: Props) => {
  const { open, itemData, onClose } = props;
  const [form, setForm] = useSetState({ ...itemData });
  const [option, setOption] = useSetState(itemData.option ?? {});
  const [showOpt, setShowOpt] = useState(!!itemData.option);

  useEffect(() => {
    if (itemData) {
      setForm({ ...itemData });
      setOption(itemData.option ?? {});
      setShowOpt(!!itemData.option?.user_agent);
    }
  }, [itemData]);

  const onUpdate = useLockFn(async () => {
    try {
      const { uid } = itemData;
      const { name, desc, url } = form;
      const option_ = showOpt ? option : undefined;

      if (itemData.type === "remote" && !url) {
        throw new Error("Remote URL should not be null");
      }

      await patchProfile(uid, { uid, name, desc, url, option: option_ });
      setShowOpt(false);
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
    (form.url ? "remote" : form.file?.endsWith("js") ? "script" : "local");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle sx={{ pb: 0.5 }}>Edit Profile</DialogTitle>

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
        />

        <TextField
          {...textFieldProps}
          label="Descriptions"
          value={form.desc}
          onChange={(e) => setForm({ desc: e.target.value })}
        />

        {type === "remote" && (
          <TextField
            {...textFieldProps}
            label="Subscription Url"
            value={form.url}
            onChange={(e) => setForm({ url: e.target.value })}
          />
        )}

        {showOpt && (
          <TextField
            {...textFieldProps}
            label="User Agent"
            value={option.user_agent}
            onChange={(e) => setOption({ user_agent: e.target.value })}
          />
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2, position: "relative" }}>
        {form.type === "remote" && (
          <IconButton
            size="small"
            sx={{ position: "absolute", left: 18 }}
            onClick={() => setShowOpt((o) => !o)}
          >
            <Settings />
          </IconButton>
        )}

        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onUpdate} variant="contained">
          Update
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProfileEdit;
