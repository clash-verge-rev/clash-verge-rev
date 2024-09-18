import { Notice } from "@/components/base";
import { useWindowSize } from "@/hooks/use-window-size";
import { getTemplate } from "@/services/cmds";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useLockFn } from "ahooks";
import * as monaco from "monaco-editor";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import pac from "types-pac/pac.d.ts?raw";

interface Props {
  title?: string | ReactNode;
  property: string;
  open: boolean;
  language: "javascript" | "css";
  scope?: "pac" | "script";
  onClose: () => void;
  onChange?: (content: string) => void;
}

// PAC definition
monaco.languages.typescript.javascriptDefaults.addExtraLib(pac, "pac.d.ts");
monaco.languages.registerCompletionItemProvider("javascript", {
  provideCompletionItems: (model, position) => ({
    suggestions: [
      {
        label: "%mixed-port%",
        kind: monaco.languages.CompletionItemKind.Text,
        insertText: "%mixed-port%",
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: model.getWordUntilPosition(position).startColumn - 1,
          endColumn: model.getWordUntilPosition(position).endColumn - 1,
        },
      },
    ],
  }),
});

export const EditorViewer = (props: Props) => {
  const { title, property, open, language, scope, onClose, onChange } = props;
  const { t } = useTranslation();
  const editorDomRef = useRef<any>();
  const instanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const registerCodeLensRef = useRef<any>();
  const themeMode = useThemeMode();
  const { size } = useWindowSize();

  useEffect(() => {
    if (!open) return;

    const fetchContent = Promise.resolve(property);
    fetchContent.then((data) => {
      const dom = editorDomRef.current;

      if (!dom) return;

      if (instanceRef.current) instanceRef.current.dispose();

      const uri = monaco.Uri.parse(`${nanoid()}.${scope}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);
      instanceRef.current = monaco.editor.create(editorDomRef.current, {
        model: model,
        language: language,
        tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4, // 根据语言类型设置缩进大小
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: dom.clientWidth >= 1000 }, // 超过一定宽度显示minimap滚动条
        mouseWheelZoom: true, // 按住Ctrl滚轮调节缩放比例
        renderValidationDecorations: "on", // 只读模式下显示校验信息
        quickSuggestions: {
          strings: true,
          comments: true,
          other: true,
        },
        automaticLayout: true,
        // padding: {
        //   top: 33, // 顶部padding防止遮挡snippets
        // },
        fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
          getSystem() === "windows" ? ", twemoji mozilla" : ""
        }`,
        fontLigatures: true, // 连字符
        smoothScrolling: true, // 平滑滚动
      });

      if (scope && "pac" === scope) {
        const generateCommand = instanceRef.current?.addCommand(
          0,
          () => {
            getTemplate(scope, language).then((templateContent) => {
              instanceRef.current?.setValue(templateContent);
            });
          },
          "",
        );
        registerCodeLensRef.current = monaco.languages.registerCodeLensProvider(
          ["javascript"],
          {
            provideCodeLenses(model, token) {
              return {
                lenses: [
                  {
                    range: {
                      startLineNumber: 1,
                      startColumn: 1,
                      endLineNumber: 2,
                      endColumn: 1,
                    },
                    id: "Regenerate Template Content",
                    command: {
                      id: generateCommand!,
                      title: t("Regenerate Template Content"),
                    },
                  },
                ],
                dispose: () => {},
              };
            },
            resolveCodeLens(model, codeLens, token) {
              return codeLens;
            },
          },
        );
      }
    });

    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
        registerCodeLensRef.current?.dispose();
        instanceRef.current = null;
        registerCodeLensRef.current = null;
      }
    };
  }, [open]);

  instanceRef.current?.updateOptions({
    minimap: { enabled: size.width >= 1000 },
  });

  const onSave = useLockFn(async () => {
    const value = instanceRef.current?.getValue();

    if (value == undefined) return;

    try {
      onChange?.(value);
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{title ?? t("Edit File")}</DialogTitle>

      <DialogContent
        sx={{
          width: "94%",
          height: `${size.height - 200}px`,
          pb: 1,
          userSelect: "text",
        }}>
        <div style={{ width: "100%", height: "100%" }} ref={editorDomRef} />
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
