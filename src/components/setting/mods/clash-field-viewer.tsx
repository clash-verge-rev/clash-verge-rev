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
import { changeProfileValid, getProfiles } from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import enhance, {
  DEFAULT_FIELDS,
  HANDLE_FIELDS,
  USE_FLAG_FIELDS,
} from "@/services/enhance";
import { BuildCircleRounded, InfoRounded } from "@mui/icons-material";

interface Props {
  handler: ModalHandler;
  onError: (err: Error) => void;
}

const fieldSorter = (a: string, b: string) => {
  if (a.includes("-") === a.includes("-")) {
    if (a.length === b.length) return a.localeCompare(b);
    return a.length - b.length;
  } else if (a.includes("-")) return 1;
  else if (b.includes("-")) return -1;
  return 0;
};

const useFields = [...USE_FLAG_FIELDS].sort(fieldSorter);
const handleFields = [...HANDLE_FIELDS, ...DEFAULT_FIELDS].sort(fieldSorter);

const ClashFieldViewer = ({ handler, onError }: Props) => {
  const { t } = useTranslation();

  const { data, mutate } = useSWR("getProfiles", getProfiles);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const { config: enhanceConfig, use: enhanceUse } = enhance.getFieldsState();

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  console.log("render");

  useEffect(() => {
    if (open) mutate();
  }, [open]);

  useEffect(() => {
    setSelected([...(data?.valid || []), ...enhanceUse]);
  }, [data?.valid, enhanceUse]);

  const handleChange = (item: string) => {
    if (!item) return;

    setSelected((old) =>
      old.includes(item) ? old.filter((e) => e !== item) : [...old, item]
    );
  };

  const handleSave = async () => {
    setOpen(false);

    const oldSet = new Set([...(data?.valid || []), ...enhanceUse]);
    const curSet = new Set(selected.concat([...oldSet]));

    if (curSet.size === oldSet.size) return;

    try {
      await changeProfileValid([...new Set(selected)]);
      mutate();
    } catch (err: any) {
      onError(err);
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
        {useFields.map((item) => {
          const inSelect = selected.includes(item);
          const inConfig = enhanceConfig.includes(item);
          const inConfigUse = enhanceUse.includes(item);
          const inValid = data?.valid?.includes(item);

          return (
            <Stack key={item} mb={0.5} direction="row" alignItems="center">
              <Checkbox
                checked={inSelect}
                size="small"
                sx={{ p: 0.5 }}
                onChange={() => handleChange(item)}
              />
              <Typography width="100%">{item}</Typography>

              {inConfigUse && !inValid && <InfoIcon />}
              {!inSelect && inConfig && <WarnIcon />}
            </Stack>
          );
        })}

        <Divider sx={{ my: 0.5 }} />

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

function InfoIcon() {
  return (
    <Tooltip title="This field is provided by Merge Profile.">
      <BuildCircleRounded
        color="info"
        sx={{ cursor: "pointer", opacity: 0.5 }}
      />
    </Tooltip>
  );
}

export default ClashFieldViewer;
