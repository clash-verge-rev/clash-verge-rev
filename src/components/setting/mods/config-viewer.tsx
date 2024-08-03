import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Chip } from "@mui/material";
import { getRuntimeYaml } from "@/services/cmds";
import { DialogRef } from "@/components/base";
import { EditorViewer } from "@/components/profile/editor-viewer";

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
          {t("Runtime Config")}
          <Chip label={t("ReadOnly")} size="small" />
        </Box>
      }
      initialData={Promise.resolve(runtimeConfig)}
      readOnly
      language="yaml"
      schema="clash"
      onClose={() => setOpen(false)}
    />
  );
});
