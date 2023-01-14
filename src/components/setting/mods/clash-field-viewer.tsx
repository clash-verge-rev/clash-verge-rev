import useSWR from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox, Divider, Stack, Tooltip, Typography } from "@mui/material";
import { InfoRounded } from "@mui/icons-material";
import { getRuntimeExists } from "@/services/cmds";
import {
  HANDLE_FIELDS,
  DEFAULT_FIELDS,
  OTHERS_FIELDS,
} from "@/utils/clash-fields";
import { BaseDialog, DialogRef } from "@/components/base";
import { useProfiles } from "@/hooks/use-profiles";
import { Notice } from "@/components/base";

const otherFields = [...OTHERS_FIELDS];
const handleFields = [...HANDLE_FIELDS, ...DEFAULT_FIELDS];

export const ClashFieldViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { profiles = {}, patchProfiles } = useProfiles();
  const { data: existsKeys = [], mutate: mutateExists } = useSWR(
    "getRuntimeExists",
    getRuntimeExists
  );

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useImperativeHandle(ref, () => ({
    open: () => {
      mutateExists();
      setSelected(profiles.valid || []);
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

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
      await patchProfiles({ valid: [...curSet] });
      // Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  };

  return (
    <BaseDialog
      open={open}
      title={t("Clash Field")}
      contentSx={{
        pb: 0,
        width: 320,
        height: 300,
        overflowY: "auto",
        userSelect: "text",
      }}
      okBtn={t("Save")}
      cancelBtn={t("Back")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={handleSave}
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
    </BaseDialog>
  );
});

function WarnIcon() {
  return (
    <Tooltip title="The field exists in the config but not enabled.">
      <InfoRounded color="warning" sx={{ cursor: "pointer", opacity: 0.5 }} />
    </Tooltip>
  );
}
