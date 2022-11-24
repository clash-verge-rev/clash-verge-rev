import { useEffect, useRef } from "react";
import { useLockFn } from "ahooks";
import { useRecoilValue } from "recoil";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { atomThemeMode } from "@/services/states";
import { readProfileFile, saveProfileFile } from "@/services/cmds";
import { Notice } from "@/components/base";

import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import { editor } from "monaco-editor/esm/vs/editor/editor.api";

interface Props {
  uid: string;
  open: boolean;
  mode: "yaml" | "javascript";
  onClose: () => void;
  onChange?: () => void;
}

export const EditorViewer = (props: Props) => {
  const { uid, open, mode, onClose, onChange } = props;

  const { t } = useTranslation();
  const editorRef = useRef<any>();
  const instanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const themeMode = useRecoilValue(atomThemeMode);

  useEffect(() => {
    if (!open) return;

    readProfileFile(uid).then((data) => {
      const dom = editorRef.current;

      if (!dom) return;
      if (instanceRef.current) instanceRef.current.dispose();

      instanceRef.current = editor.create(editorRef.current, {
        value: data,
        language: mode,
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: false },
      });
    });

    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
        instanceRef.current = null;
      }
    };
  }, [open]);

  const onSave = useLockFn(async () => {
    const value = instanceRef.current?.getValue();

    if (value == null) return;

    try {
      await saveProfileFile(uid, value);
      onChange?.();
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("Edit File")}</DialogTitle>

      <DialogContent sx={{ width: 520, pb: 1, userSelect: "text" }}>
        <div style={{ width: "100%", height: "420px" }} ref={editorRef} />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t("Cancel")}
        </Button>
        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
