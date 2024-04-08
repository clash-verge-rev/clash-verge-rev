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
import { nanoid } from "nanoid";

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { editor } from "monaco-editor/esm/vs/editor/editor.api";
import { configureMonacoYaml } from "monaco-yaml";

interface Props {
  uid: string;
  open: boolean;
  language: "yaml" | "javascript";
  schema?: string;
  onClose: () => void;
  onChange?: () => void;
}

loader.config({ monaco });
loader.init().then(async (monaco) => {
  // 配置yaml格式相关schema
  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
    schemas: [
      {
        // clash配置文件(待施工)
        uri: "https://raw.githubusercontent.com/dongchengjie/airport/main/schema.json",
        fileMatch: ["**/*.clash.yaml"],
      },
      {
        // merge类型profile文件(待施工)
        uri: "https://raw.githubusercontent.com/dongchengjie/airport/main/schema.json",
        fileMatch: ["**/*.merge.yaml"],
      },
    ],
  });
});

export const EditorViewer = (props: Props) => {
  const { uid, open, language, schema, onClose, onChange } = props;

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

      const uri = monaco.Uri.parse(`${nanoid()}.${schema}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);
      instanceRef.current = editor.create(editorRef.current, {
        model: model,
        language: language,
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: dom.clientWidth >= 1000 },
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
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{t("Edit File")}</DialogTitle>

      <DialogContent
        sx={{ width: "95%", height: "100vh", pb: 1, userSelect: "text" }}
      >
        <div style={{ width: "100%", height: "100%" }} ref={editorRef} />
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
