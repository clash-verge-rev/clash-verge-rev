import MonacoEditor from "@monaco-editor/react";
import {
  CloseFullscreenRounded,
  FormatPaintRounded,
  OpenInFullRounded,
} from "@mui/icons-material";
import {
  Button,
  ButtonGroup,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLockFn } from "ahooks";
import { type JSONSchema7 } from "json-schema";
import mergeSchema from "meta-json-schema/schemas/clash-verge-merge-json-schema.json";
import metaSchema from "meta-json-schema/schemas/meta-json-schema.json";
import * as monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import pac from "types-pac/pac.d.ts?raw";

import { showNotice } from "@/services/noticeService";
import { useThemeMode } from "@/services/states";
import debounce from "@/utils/debounce";
import getSystem from "@/utils/get-system";
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
        // @ts-expect-error -- meta schema JSON import does not satisfy JSONSchema7 at compile time
        schema: metaSchema as JSONSchema7,
      },
      {
        uri: "http://example.com/clash-verge-merge-json-schema.json",
        fileMatch: ["**/*.merge.yaml"],
        // @ts-expect-error -- merge schema JSON import does not satisfy JSONSchema7 at compile time
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
    title,
    initialData,
    readOnly = false,
    language = "yaml",
    schema,
    onChange,
    onSave,
    onClose,
  } = props;

  const resolvedTitle = title ?? t("profiles.components.menu.editFile");
  const resolvedInitialData = useMemo(
    () => initialData ?? Promise.resolve(""),
    [initialData],
  );

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(undefined);
  const prevData = useRef<string | undefined>("");
  const currData = useRef<string | undefined>("");

  const beforeMount = () => {
    monacoInitialization(); // initialize monaco
  };

  const onMount = async (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    // retrieve initial data
    await resolvedInitialData.then((data) => {
      prevData.current = data;
      currData.current = data;

      // create and set model
      const uri = monaco.Uri.parse(`${nanoid()}.${schema}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);
      editorRef.current?.setModel(model);
    });
  };

  const handleChange = useLockFn(async (_value?: string) => {
    try {
      const value = editorRef.current?.getValue();
      currData.current = value;
      onChange?.(prevData.current, currData.current);
    } catch (err) {
      showNotice.error(err);
    }
  });

  const handleSave = useLockFn(async () => {
    try {
      if (!readOnly) {
        currData.current = editorRef.current?.getValue();
        onSave?.(prevData.current, currData.current);
      }
      onClose();
    } catch (err) {
      showNotice.error(err);
    }
  });

  const handleClose = useLockFn(async () => {
    try {
      onClose();
    } catch (err) {
      showNotice.error(err);
    }
  });

  const editorResize = useMemo(
    () =>
      debounce(() => {
        editorRef.current?.layout();
        setTimeout(() => editorRef.current?.layout(), 500);
      }, 100),
    [],
  );

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
  }, [editorResize]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{resolvedTitle}</DialogTitle>

      <DialogContent
        sx={{
          width: "auto",
          height: "calc(100vh - 185px)",
          overflow: "hidden",
        }}
      >
        <MonacoEditor
          language={language}
          theme={themeMode === "light" ? "light" : "vs-dark"}
          options={{
            tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4, // 根据语言类型设置缩进大小
            minimap: {
              enabled: document.documentElement.clientWidth >= 1500, // 超过一定宽度显示minimap滚动条
            },
            mouseWheelZoom: true, // 按住Ctrl滚轮调节缩放比例
            readOnly: readOnly, // 只读模式
            readOnlyMessage: {
              value: t("profiles.modals.editor.messages.readOnly"),
            }, // 只读模式尝试编辑时的提示信息
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
          beforeMount={beforeMount}
          onMount={onMount}
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
            title={t("profiles.modals.editor.actions.format")}
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
            title={t(
              isMaximized ? "shared.window.minimize" : "shared.window.maximize",
            )}
            onClick={() => appWindow.toggleMaximize().then(editorResize)}
          >
            {isMaximized ? <CloseFullscreenRounded /> : <OpenInFullRounded />}
          </IconButton>
        </ButtonGroup>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} variant="outlined">
          {t(readOnly ? "shared.actions.close" : "shared.actions.cancel")}
        </Button>
        {!readOnly && (
          <Button onClick={handleSave} variant="contained">
            {t("shared.actions.save")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
