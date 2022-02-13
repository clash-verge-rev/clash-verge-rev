import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import Notice from "../base/base-notice";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, desc: string) => void;
}

const ProfileNew = (props: Props) => {
  const { open, onClose, onSubmit } = props;
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const onCreate = () => {
    if (!name.trim()) {
      Notice.error("`Name` should not be null");
      return;
    }
    onSubmit(name, desc);
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Create Profile</DialogTitle>
      <DialogContent sx={{ width: 320, pb: 0.5 }}>
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
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onCreate} variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProfileNew;
