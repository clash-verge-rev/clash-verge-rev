import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecoilValue } from "recoil";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { InfoRounded } from "@mui/icons-material";
import { atomThemeMode } from "@/services/states";
import { getRuntimeYaml } from "@/services/cmds";

import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import { editor } from "monaco-editor/esm/vs/editor/editor.api";

const ConfigViewer = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const editorRef = useRef<any>();
  const instanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const themeMode = useRecoilValue(atomThemeMode);

  useEffect(() => {
    if (!open) return;

    getRuntimeYaml().then((data) => {
      const dom = editorRef.current;

      if (!dom) return;
      if (instanceRef.current) instanceRef.current.dispose();

      instanceRef.current = editor.create(editorRef.current, {
        value: data ?? "# Error\n",
        language: "yaml",
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: false },
        readOnly: true,
      });
    });

    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
        instanceRef.current = null;
      }
    };
  }, [open]);

  return (
    <>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>
          {t("Runtime Config")} <Chip label="ReadOnly" size="small" />
        </DialogTitle>

        <DialogContent sx={{ width: 520, pb: 1 }}>
          <div style={{ width: "100%", height: "420px" }} ref={editorRef} />
        </DialogContent>

        <DialogActions>
          <Button variant="outlined" onClick={() => setOpen(false)}>
            {t("Back")}
          </Button>
        </DialogActions>
      </Dialog>

      <InfoRounded
        fontSize="small"
        style={{ cursor: "pointer", opacity: 0.75 }}
        onClick={() => setOpen(true)}
      />
    </>
  );
};
export default ConfigViewer;
