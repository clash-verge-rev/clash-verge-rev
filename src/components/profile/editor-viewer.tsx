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
import { editor } from "monaco-editor/esm/vs/editor/editor.api";
import { configureMonacoYaml } from "monaco-yaml";

import { type JSONSchema7 } from "json-schema";
import metaSchema from "meta-json-schema/schemas/meta-json-schema.json";
import mergeSchema from "meta-json-schema/schemas/clash-verge-merge-json-schema.json";

interface Props {
  mode: "profile" | "text";
  property: string;
  open: boolean;
  language: "yaml" | "javascript" | "css";
  schema?: "clash" | "merge";
  onClose: () => void;
  onChange?: (content?: string) => void;
}

// yaml worker
configureMonacoYaml(monaco, {
  validate: true,
  enableSchemaRequest: true,
  schemas: [
    {
      uri: "http://example.com/meta-json-schema.json",
      fileMatch: ["**/*.clash.yaml"],
      //@ts-ignore
      schema: metaSchema as JSONSchema7,
    },
    {
      uri: "http://example.com/clash-verge-merge-json-schema.json",
      fileMatch: ["**/*.merge.yaml"],
      //@ts-ignore
      schema: mergeSchema as JSONSchema7,
    },
  ],
});

export const EditorViewer = (props: Props) => {
  const { mode, property, open, language, schema, onClose, onChange } = props;
  const { t } = useTranslation();
  const editorRef = useRef<any>();
  const instanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const themeMode = useRecoilValue(atomThemeMode);

  useEffect(() => {
    if (!open) return;

    let fetchContent;
    switch (mode) {
      case "profile": // profile文件
        fetchContent = readProfileFile(property);
        break;
      case "text": // 文本内容
        fetchContent = Promise.resolve(property);
        break;
    }
    fetchContent.then((data) => {
      const dom = editorRef.current;

      if (!dom) return;

      if (instanceRef.current) instanceRef.current.dispose();

      const uri = monaco.Uri.parse(`${nanoid()}.${schema}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);
      instanceRef.current = editor.create(editorRef.current, {
        model: model,
        language: language,
        tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4, // 根据语言类型设置缩进
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: dom.clientWidth >= 1000 }, // 超过一定宽度显示minimap滚动条
        mouseWheelZoom: true, // Ctrl+滚轮调节缩放
        quickSuggestions: {
          strings: true, // 字符串类型的建议
          comments: true, // 注释类型的建议
          other: true, // 其他类型的建议
        },
        padding: {
          top: 33, // 顶部padding防止遮挡snippets
        },
        fontFamily:
          "Fira Code, Roboto Mono, Source Code Pro, Menlo, Monaco, Consolas, Courier New, monospace",
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
      if (mode === "profile") {
        await saveProfileFile(property, value);
      }
      onChange?.(value);
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{t("Edit File")}</DialogTitle>

      <DialogContent
        sx={{ width: "94%", height: "100vh", pb: 1, userSelect: "text" }}
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
