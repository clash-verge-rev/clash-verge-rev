import { Notice } from "@/components/base";
import { useWindowSize } from "@/hooks/use-window-size";
import { getTemplate } from "@/services/cmds";
import monaco from "@/services/monaco";
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
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  title?: string | ReactNode;
  property: string;
  open: boolean;
  language: "javascript" | "css" | "yaml";
  scope?: "pac" | "script" | "clash";
  readonly?: boolean;
  onClose: () => void;
  onChange?: (content: string) => void;
}

export const EditorViewer = (props: Props) => {
  const {
    title,
    property,
    open,
    language,
    scope,
    readonly,
    onClose,
    onChange,
  } = props;
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
        readOnly: readonly,
        readOnlyMessage: { value: t("ReadOnlyMessage") },
        tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4,
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: dom.clientWidth >= 1000 },
        mouseWheelZoom: true,
        renderValidationDecorations: "on", // 只读模式下显示校验信息
        quickSuggestions: {
          strings: true,
          comments: true,
          other: true,
        },
        fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
          getSystem() === "windows" ? ", twemoji mozilla" : ""
        }`,
        automaticLayout: true,
        fontLigatures: true,
        smoothScrolling: true,
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
      instanceRef.current?.dispose();
      registerCodeLensRef.current?.dispose();
      instanceRef.current = null;
      registerCodeLensRef.current = null;
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
          height: `${size.height - 200}px`,
          pb: 1,
          userSelect: "text",
        }}>
        <div className="h-full w-full overflow-hidden" ref={editorDomRef} />
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
