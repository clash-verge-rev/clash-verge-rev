import { useState } from "react";
import { useSWRConfig } from "swr";
import { useLockFn, useSetState } from "ahooks";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { Settings } from "@mui/icons-material";
import { createProfile } from "../../services/cmds";
import Notice from "../base/base-notice";

interface Props {
  open: boolean;
  onClose: () => void;
}

// create a new profile
// remote / local file / merge / script
const ProfileNew = (props: Props) => {
  const { open, onClose } = props;

  const { mutate } = useSWRConfig();
  const [form, setForm] = useSetState({
    type: "remote",
    name: "",
    desc: "",
    url: "",
  });

  const [showOpt, setShowOpt] = useState(false);
  const [option, setOption] = useSetState({
    user_agent: "",
  }); // able to add more option

  const onCreate = useLockFn(async () => {
    if (!form.type) {
      Notice.error("`Type` should not be null");
      return;
    }

    try {
      const name = form.name || `${form.type} file`;

      if (form.type === "remote" && !form.url) {
        throw new Error("The URL should not be null");
      }

      const option_ = showOpt ? option : undefined;
      await createProfile({ ...form, name, option: option_ });
      setForm({ type: "remote", name: "", desc: "", url: "" });
      setOption({ user_agent: "" });
      setShowOpt(false);

      mutate("getProfiles");
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  const textFieldProps = {
    fullWidth: true,
    size: "small",
    margin: "normal",
    variant: "outlined",
  } as const;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle sx={{ pb: 0.5 }}>Create Profile</DialogTitle>

      <DialogContent sx={{ width: 336, pb: 1 }}>
        <FormControl size="small" fullWidth sx={{ mt: 2, mb: 1 }}>
          <InputLabel>Type</InputLabel>
          <Select
            autoFocus
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ type: e.target.value })}
          >
            <MenuItem value="remote">Remote</MenuItem>
            <MenuItem value="local">Local</MenuItem>
            <MenuItem value="script">Script</MenuItem>
            <MenuItem value="merge">Merge</MenuItem>
          </Select>
        </FormControl>

        <TextField
          {...textFieldProps}
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

        {form.type === "remote" && (
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
        <Button onClick={onCreate} variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProfileNew;
