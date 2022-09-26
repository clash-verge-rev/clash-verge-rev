import useSWR from "swr";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { InfoRounded } from "@mui/icons-material";
import {
  changeProfileValid,
  getProfiles,
  getRuntimeExists,
} from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import {
  HANDLE_FIELDS,
  DEFAULT_FIELDS,
  OTHERS_FIELDS,
} from "@/utils/clash-fields";
import Notice from "@/components/base/base-notice";

interface Props {
  handler: ModalHandler;
}

const fieldSorter = (a: string, b: string) => {
  if (a.includes("-") === a.includes("-")) {
    if (a.length === b.length) return a.localeCompare(b);
    return a.length - b.length;
  } else if (a.includes("-")) return 1;
  else if (b.includes("-")) return -1;
  return 0;
};

const otherFields = [...OTHERS_FIELDS].sort(fieldSorter);
const handleFields = [...HANDLE_FIELDS, ...DEFAULT_FIELDS].sort(fieldSorter);

const ClashFieldViewer = ({ handler }: Props) => {
  const { t } = useTranslation();

  const { data: profiles = {}, mutate: mutateProfile } = useSWR(
    "getProfiles",
    getProfiles
  );
  const { data: existsKeys = [], mutate: mutateExists } = useSWR(
    "getRuntimeExists",
    getRuntimeExists
  );

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  useEffect(() => {
    if (open) {
      mutateProfile();
      mutateExists();
      setSelected(profiles.valid || []);
    }
  }, [open, profiles.valid]);

  const handleChange = (item: string) => {
    if (!item) return;

    setSelected((old) =>
      old.includes(item) ? old.filter((e) => e !== item) : [...old, item]
    );
  };

  const handleSave = async () => {
    setOpen(false);

    const oldSet = new Set(profiles.valid || []);
    const curSet = new Set(selected);
    const joinSet = new Set(selected.concat([...oldSet]));

    if (curSet.size === oldSet.size && curSet.size === joinSet.size) return;

    try {
      await changeProfileValid([...curSet]);
      mutateProfile();
      // Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle>{t("Clash Field")}</DialogTitle>

      <DialogContent
        sx={{
          pb: 0,
          width: 320,
          height: 300,
          overflowY: "auto",
          userSelect: "text",
        }}
      >
        {otherFields.map((item) => {
          const inSelect = selected.includes(item);
          const inConfig = existsKeys.includes(item);

          return (
            <Stack key={item} mb={0.5} direction="row" alignItems="center">
              <Checkbox
                checked={inSelect}
                size="small"
                sx={{ p: 0.5 }}
                onChange={() => handleChange(item)}
              />
              <Typography width="100%">{item}</Typography>

              {!inSelect && inConfig && <WarnIcon />}
            </Stack>
          );
        })}

        <Divider sx={{ my: 1 }}>
          <Typography color="text.secondary" fontSize={14}>
            Clash Verge Control Fields
          </Typography>
        </Divider>

        {handleFields.map((item) => (
          <Stack key={item} mb={0.5} direction="row" alignItems="center">
            <Checkbox defaultChecked disabled size="small" sx={{ p: 0.5 }} />
            <Typography>{item}</Typography>
          </Stack>
        ))}
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={() => setOpen(false)}>
          {t("Back")}
        </Button>
        <Button variant="contained" onClick={handleSave}>
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

function WarnIcon() {
  return (
    <Tooltip title="The field exists in the config but not enabled.">
      <InfoRounded color="warning" sx={{ cursor: "pointer", opacity: 0.5 }} />
    </Tooltip>
  );
}

export default ClashFieldViewer;
