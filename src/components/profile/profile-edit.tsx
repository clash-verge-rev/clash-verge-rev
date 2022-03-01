import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { mutate } from "swr";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { CmdType } from "../../services/types";
import { patchProfile } from "../../services/cmds";
import Notice from "../base/base-notice";

interface Props {
  open: boolean;
  itemData: CmdType.ProfileItem;
  onClose: () => void;
}

// edit the profile item
const ProfileEdit = (props: Props) => {
  const { open, itemData, onClose } = props;

  // todo: more type
  const [name, setName] = useState(itemData.name);
  const [desc, setDesc] = useState(itemData.desc);
  const [url, setUrl] = useState(itemData.url);

  useEffect(() => {
    if (itemData) {
      setName(itemData.name);
      setDesc(itemData.desc);
      setUrl(itemData.url);
    }
  }, [itemData]);

  const onUpdate = useLockFn(async () => {
    try {
      const { uid } = itemData;
      await patchProfile(uid, { uid, name, desc, url });
      mutate("getProfiles");
      onClose();
    } catch (err: any) {
      Notice.error(err?.message || err?.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Edit Profile</DialogTitle>
      <DialogContent sx={{ width: 360, pb: 0.5 }}>
        <TextField
          autoFocus
          fullWidth
          label="Name"
          margin="dense"
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <TextField
          fullWidth
          label="Descriptions"
          margin="normal"
          variant="outlined"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />

        <TextField
          fullWidth
          label="Remote URL"
          margin="normal"
          variant="outlined"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>

        <Button onClick={onUpdate} variant="contained">
          Update
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProfileEdit;
