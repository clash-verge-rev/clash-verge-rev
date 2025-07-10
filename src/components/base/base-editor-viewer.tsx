import { useWindowSize } from "@/hooks/use-window-size";
import {
  defaultOptions,
  generateTemplate,
  monaco,
  registerPacCompletion,
  registerPacFunctionLib,
} from "@/services/monaco";
import { useThemeMode } from "@/services/states";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { IDisposable } from "monaco-editor";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNotice } from "./notifice";

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
  const editorDomRef = useRef<any>(null);
  const instanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const themeMode = useThemeMode();
  const { size } = useWindowSize();
  const { notice } = useNotice();

  useEffect(() => {
    if (!open) return;

    const fetchContent = Promise.resolve(property);
    let pacFunLib: IDisposable | null = null;
    let pacCompletion: IDisposable | null = null;
    let codeLens: IDisposable | null = null;
    fetchContent.then((data) => {
      const dom = editorDomRef.current;

      if (!dom) return;

      if (instanceRef.current) instanceRef.current.dispose();

      const uri = monaco.Uri.parse(`${nanoid()}.${scope}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);

      instanceRef.current = monaco.editor.create(editorDomRef.current, {
        ...defaultOptions,
        model: model,
        language: language,
        tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4,
        readOnly: readonly,
        theme: themeMode === "dark" ? "vs-dark" : "light",
        minimap: { enabled: size.width >= 1000 },
      });

      if (scope && "pac" === scope) {
        pacFunLib = registerPacFunctionLib();
        pacCompletion = registerPacCompletion();
        codeLens = generateTemplate({
          monacoInstance: instanceRef.current,
          languageSelector: ["javascript"],
          generateType: "pac",
          generateLanguage: "javascript",
          showCondition: true,
        });
      }
    });

    return () => {
      instanceRef.current?.dispose();
      pacFunLib?.dispose();
      pacCompletion?.dispose();
      codeLens?.dispose();
      instanceRef.current = null;
    };
  }, [open]);

  // 更新 monaco 显示小地图
  useEffect(() => {
    if (!instanceRef.current) return;

    const minimap = instanceRef.current.getOption(
      monaco.editor.EditorOption.minimap,
    );
    if (!minimap.enabled && size.width >= 1000) {
      console.log("show mini map");
      instanceRef.current.updateOptions({
        minimap: { enabled: true },
      });
    }
    if (minimap.enabled && size.width < 1000) {
      console.log("disable mini map");
      instanceRef.current.updateOptions({
        minimap: { enabled: false },
      });
    }
  }, [size]);

  const onSave = useLockFn(async () => {
    const value = instanceRef.current?.getValue();

    if (value == undefined) return;

    try {
      onChange?.(value);
      onClose();
    } catch (err: any) {
      notice("error", err.message || err.toString());
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
