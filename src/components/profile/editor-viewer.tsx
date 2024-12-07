import { ReactNode, useEffect, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Button,
  ButtonGroup,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@mui/material";
import {
  FormatPaintRounded,
  OpenInFullRounded,
  CloseFullscreenRounded,
} from "@mui/icons-material";
import { useThemeMode } from "@/services/states";
import { Notice } from "@/components/base";
import { nanoid } from "nanoid";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import getSystem from "@/utils/get-system";
import debounce from "@/utils/debounce";

import * as monaco from "monaco-editor";
import MonacoEditor from "react-monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import { type JSONSchema7 } from "json-schema";
import metaSchema from "meta-json-schema/schemas/meta-json-schema.json";
import mergeSchema from "meta-json-schema/schemas/clash-verge-merge-json-schema.json";
import pac from "types-pac/pac.d.ts?raw";
const appWindow = getCurrentWebviewWindow();

type Language = "yaml" | "javascript" | "css";
type Schema<T extends Language> = LanguageSchemaMap[T];
interface LanguageSchemaMap {
  yaml: "clash" | "merge";
  javascript: never;
  css: never;
}

interface Props<T extends Language> {
  open: boolean;
  title?: string | ReactNode;
  initialData: Promise<string>;
  readOnly?: boolean;
  language: T;
  schema?: Schema<T>;
  onChange?: (prev?: string, curr?: string) => void;
  onSave?: (prev?: string, curr?: string) => void;
  onClose: () => void;
}

let initialized = false;
const monacoInitialization = () => {
  if (initialized) return;

  // configure yaml worker
  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
    schemas: [
      {
        uri: "http://example.com/meta-json-schema.json",
        fileMatch: ["**/*.clash.yaml"],
        // @ts-ignore
        schema: metaSchema as JSONSchema7,
      },
      {
        uri: "http://example.com/clash-verge-merge-json-schema.json",
        fileMatch: ["**/*.merge.yaml"],
        // @ts-ignore
        schema: mergeSchema as JSONSchema7,
      },
    ],
  });
  // configure PAC definition
  monaco.languages.typescript.javascriptDefaults.addExtraLib(pac, "pac.d.ts");

  initialized = true;
};

export const EditorViewer = <T extends Language>(props: Props<T>) => {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const [isMaximized, setIsMaximized] = useState(false);

  const {
    open = false,
    title = t("Edit File"),
    initialData = Promise.resolve(""),
    readOnly = false,
    language = "yaml",
    schema,
    onChange,
    onSave,
    onClose,
  } = props;

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const prevData = useRef<string | undefined>("");
  const currData = useRef<string | undefined>("");

  const editorWillMount = () => {
    monacoInitialization(); // initialize monaco
  };

  const editorDidMount = async (
    editor: monaco.editor.IStandaloneCodeEditor,
  ) => {
    editorRef.current = editor;

    // retrieve initial data
    await initialData.then((data) => {
      prevData.current = data;
      currData.current = data;

      // create and set model
      const uri = monaco.Uri.parse(`${nanoid()}.${schema}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);
      editorRef.current?.setModel(model);
    });
  };

  const handleChange = useLockFn(async (value: string | undefined) => {
    try {
      currData.current = value;
      onChange?.(prevData.current, currData.current);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  const handleSave = useLockFn(async () => {
    try {
      !readOnly && onSave?.(prevData.current, currData.current);
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  const handleClose = useLockFn(async () => {
    try {
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  const editorResize = debounce(() => {
    editorRef.current?.layout();
    setTimeout(() => editorRef.current?.layout(), 500);
  }, 100);

  useEffect(() => {
    const onResized = debounce(() => {
      editorResize();
      appWindow.isMaximized().then((maximized) => {
        setIsMaximized(() => maximized);
      });
    }, 100);
    const unlistenResized = appWindow.onResized(onResized);

    return () => {
      unlistenResized.then((fn) => fn());
      editorRef.current?.dispose();
      editorRef.current = undefined;
    };
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent
        sx={{
          width: "auto",
          height: "calc(100vh - 185px)",
          overflow: "hidden",
        }}
      >
        <MonacoEditor
          language={language}
          theme={themeMode === "light" ? "vs" : "vs-dark"}
          options={{
            tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4, // 根据语言类型设置缩进大小
            minimap: {
              enabled: document.documentElement.clientWidth >= 1500, // 超过一定宽度显示minimap滚动条
            },
            mouseWheelZoom: true, // 按住Ctrl滚轮调节缩放比例
            readOnly: readOnly, // 只读模式
            readOnlyMessage: { value: t("ReadOnlyMessage") }, // 只读模式尝试编辑时的提示信息
            renderValidationDecorations: "on", // 只读模式下显示校验信息
            quickSuggestions: {
              strings: true, // 字符串类型的建议
              comments: true, // 注释类型的建议
              other: true, // 其他类型的建议
            },
            padding: {
              top: 33, // 顶部padding防止遮挡snippets
            },
            fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
              getSystem() === "windows" ? ", twemoji mozilla" : ""
            }`,
            fontLigatures: false, // 连字符
            smoothScrolling: true, // 平滑滚动
          }}
          editorWillMount={editorWillMount}
          editorDidMount={editorDidMount}
          onChange={handleChange}
        />

        <ButtonGroup
          variant="contained"
          sx={{ position: "absolute", left: "14px", bottom: "8px" }}
        >
          <IconButton
            size="medium"
            color="inherit"
            sx={{ display: readOnly ? "none" : "" }}
            title={t("Format document")}
            onClick={() =>
              editorRef.current
                ?.getAction("editor.action.formatDocument")
                ?.run()
            }
          >
            <FormatPaintRounded fontSize="inherit" />
          </IconButton>
          <IconButton
            size="medium"
            color="inherit"
            title={t(isMaximized ? "Minimize" : "Maximize")}
            onClick={() => appWindow.toggleMaximize().then(editorResize)}
          >
            {isMaximized ? <CloseFullscreenRounded /> : <OpenInFullRounded />}
          </IconButton>
        </ButtonGroup>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} variant="outlined">
          {t(readOnly ? "Close" : "Cancel")}
        </Button>
        {!readOnly && (
          <Button onClick={handleSave} variant="contained">
            {t("Save")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
