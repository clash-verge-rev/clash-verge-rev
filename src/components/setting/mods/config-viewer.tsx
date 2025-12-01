import { Box, Chip } from "@mui/material";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { DialogRef } from "@/components/base";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { getRuntimeYaml } from "@/services/cmds";

export const ConfigViewer = forwardRef<DialogRef>((_, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState("");

  useImperativeHandle(ref, () => ({
    open: () => {
      getRuntimeYaml().then((data) => {
        setRuntimeConfig(data ?? "# Error getting runtime yaml\n");
        setOpen(true);
      });
    },
    close: () => setOpen(false),
  }));

  if (!open) return null;
  return (
    <EditorViewer
      open={true}
      title={
        <Box display="flex" alignItems="center" gap={2}>
          {t("settings.components.verge.advanced.fields.runtimeConfig")}
          <Chip label={t("shared.labels.readOnly")} size="small" />
        </Box>
      }
      initialData={() => Promise.resolve(runtimeConfig)}
      dataKey="runtime-config"
      readOnly
      language="yaml"
      onClose={() => setOpen(false)}
    />
  );
});
