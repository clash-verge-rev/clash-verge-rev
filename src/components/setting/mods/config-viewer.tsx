import { DialogRef } from "@/components/base";
import { ProfileEditorViewer } from "@/components/profile/profile-editor-viewer";
import { getRuntimeYaml } from "@/services/cmds";
import { Box, Chip } from "@mui/material";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

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

  return (
    <ProfileEditorViewer
      title={
        <Box>
          {t("Runtime Config")}
          <Chip label={t("ReadOnly")} size="small" />
        </Box>
      }
      open={open}
      mode="text"
      scope="clash"
      language="yaml"
      property={runtimeConfig}
      readOnly
      onClose={() => setOpen(false)}
    />
  );
});
