import { useSWRConfig } from "swr";
import { useLockFn, useSetState } from "ahooks";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
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
    name: "",
    desc: "",
    type: "remote",
    url: "",
  });

  const onCreate = useLockFn(async () => {
    if (!form.type) {
      Notice.error("`Type` should not be null");
      return;
    }

    try {
      await createProfile({ ...form });
      setForm({ name: "", desc: "", type: "remote", url: "" });
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
        <TextField
          {...textFieldProps}
          autoFocus
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ name: e.target.value })}
        />

        <FormControl size="small" fullWidth sx={{ mt: 2, mb: 1 }}>
          <InputLabel>Type</InputLabel>
          <Select
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
