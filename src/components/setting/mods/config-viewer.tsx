import { DialogRef, EditorViewer } from "@/components/base";
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
    <EditorViewer
      title={
        <div className="flex w-full items-center">
          {t("Runtime Config")}
          <Chip label={t("ReadOnly")} size="small" className="ml-2" />
        </div>
      }
      open={open}
      language="yaml"
      scope="clash"
      readonly
      property={runtimeConfig}
      onClose={() => setOpen(false)}
    />
  );
});
