import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useThemeMode } from "@/services/states";

import * as monaco from "monaco-editor";
import { useWindowSize } from "@/hooks/use-window-size";
import { Notice } from "@/components/base";
import { useLockFn } from "ahooks";

interface Props {
  open: boolean;
  data: string;
  onSave: (css: string) => void;
  onClose: () => void;
}

export const CSSEditorViewer = (props: Props) => {
  const { open, data, onSave, onClose } = props;
  const { t } = useTranslation();
  const editorRef = useRef<any>();
  const instanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const themeMode = useThemeMode();
  const { size } = useWindowSize();

  useEffect(() => {
    if (!open) return;

    setTimeout(() => {
      const dom = editorRef.current;
      if (!dom) return;

      if (instanceRef.current) instanceRef.current.dispose();

      instanceRef.current = monaco.editor.create(editorRef.current, {
        value: data,
        language: "css",
        tabSize: 4,
        theme: themeMode === "light" ? "vs" : "vs-dark",
        quickSuggestions: {
          strings: true,
          comments: true,
          other: true,
        },
        automaticLayout: true,
      });
    }, 50);

    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
        instanceRef.current = null;
      }
    };
  }, [open]);

  instanceRef.current?.updateOptions({
    minimap: { enabled: size.width >= 1000 },
  });

  const saveCSS = useLockFn(async () => {
    const value = instanceRef.current?.getValue();

    if (value == null) return;

    try {
      onSave(value);
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{t("Edit CSS Injection")}</DialogTitle>

      <DialogContent
        sx={{
          width: "94%",
          height: `${size.height - 200}px`,
          pb: 1,
          userSelect: "text",
        }}>
        <div style={{ width: "100%", height: "100%" }} ref={editorRef} />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t("Cancel")}
        </Button>
        <Button onClick={saveCSS} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
