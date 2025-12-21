import MonacoEditor from "@monaco-editor/react";
import {
  CloseFullscreenRounded,
  ContentPasteRounded,
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
import * as monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import pac from "types-pac/pac.d.ts?raw";

import { BaseLoadingOverlay } from "@/components/base";
import { showNotice } from "@/services/notice-service";
import { useThemeMode } from "@/services/states";
import debounce from "@/utils/debounce";
import getSystem from "@/utils/get-system";
const appWindow = getCurrentWebviewWindow();

type Language = "yaml" | "javascript" | "css";

interface Props<T extends Language> {
  open: boolean;
  title?: string | ReactNode;
  initialData: Promise<string> | (() => Promise<string>);
  // Logical document id; used to build a stable model path.
  dataKey?: string | number;
  readOnly?: boolean;
  language: T;
  onChange?: (prev?: string, curr?: string) => void;
  onSave?: (prev?: string, curr?: string) => void | Promise<void>;
  onClose: () => void;
}

const LOAD_TIMEOUT_MS = 15000;

let initialized = false;
const monacoInitialization = () => {
  if (initialized) return;

  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
  });
  monaco.typescript.javascriptDefaults.addExtraLib(pac, "pac.d.ts");

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
    dataKey,
    readOnly = false,
    language = "yaml",
    onChange,
    onSave,
    onClose,
  } = props;

  const resolvedTitle = title ?? t("profiles.components.menu.editFile");

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const prevData = useRef<string>("");
  const currData = useRef<string>("");
  const userEditedRef = useRef(false);
  const loadIdRef = useRef(0);
  const initialDataRef = useRef<Props<T>["initialData"]>(initialData);
  const instanceIdRef = useRef<string>(nanoid());

  const [initialText, setInitialText] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(false);

  const modelPath = useMemo(() => {
    const key = dataKey ?? "editor";
    return `${key}.${instanceIdRef.current}.${language}`;
  }, [dataKey, language]);

  const isLoading = open && initialText === null;

  useEffect(() => {
    initialDataRef.current = initialData;
  }, [initialData]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadId = ++loadIdRef.current;
    userEditedRef.current = false;
    prevData.current = "";
    currData.current = "";
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    setInitialText(null);
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    setCanSave(false);

    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      if (cancelled || loadId !== loadIdRef.current) return;
      prevData.current = "";
      currData.current = "";
      setInitialText("");
      setCanSave(false);
      showNotice.error("shared.feedback.notifications.common.refreshFailed");
    }, LOAD_TIMEOUT_MS);

    const dataPromise = Promise.resolve().then(() => {
      const dataSource = initialDataRef.current;
      if (typeof dataSource === "function") {
        return (dataSource as () => Promise<string>)();
      }
      return dataSource ?? "";
    });

    dataPromise
      .then((data) => {
        if (cancelled || loadId !== loadIdRef.current) return;
        clearTimeout(timeoutId);

        if (userEditedRef.current) {
          setCanSave(true);
          return;
        }

        const next = data ?? "";
        prevData.current = next;
        currData.current = next;

        if (didTimeout) {
          if (editorRef.current) {
            editorRef.current.setValue(next);
          } else {
            setInitialText(next);
          }
        } else {
          setInitialText(next);
        }
        setCanSave(true);
      })
      .catch((err) => {
        if (cancelled || loadId !== loadIdRef.current) return;
        clearTimeout(timeoutId);

        if (!didTimeout) {
          setInitialText("");
        }
        if (!userEditedRef.current) {
          setCanSave(false);
        }
        if (!didTimeout) {
          showNotice.error(err);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [open, dataKey, language]);

  const beforeMount = () => {
    try {
      monacoInitialization();
    } catch (err) {
      showNotice.error(err);
    }
  };

  const onMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
  };

  const handleChange = (value?: string) => {
    try {
      const next = value ?? editorRef.current?.getValue() ?? "";
      currData.current = next;
      userEditedRef.current = true;
      if (!readOnly) {
        setCanSave(true);
      }
      onChange?.(prevData.current, next);
    } catch (err) {
      showNotice.error(err);
    }
  };

  const handleSave = useLockFn(async () => {
    try {
      if (!readOnly && canSave) {
        if (!editorRef.current) return;
        currData.current = editorRef.current.getValue();
        if (onSave) {
          await onSave(prevData.current, currData.current);
          prevData.current = currData.current;
        }
      }
      onClose();
    } catch (err) {
      showNotice.error(err);
    }
  });

  const handlePaste = useLockFn(async () => {
    try {
      if (!editorRef.current || readOnly) return;
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const editor = editorRef.current;
      const model = editor.getModel();
      const selections = editor.getSelections();
      if (!model || !selections || selections.length === 0) return;
      editor.pushUndoStop();
      editor.executeEdits(
        "explicit-paste",
        selections.map((sel) => ({
          range: sel,
          text,
          forceMoveMarkers: true,
        })),
      );
      editor.pushUndoStop();
      editor.focus();
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

  useEffect(() => {
    const onResized = debounce(() => {
      appWindow
        .isMaximized()
        .then((maximized) => setIsMaximized(() => maximized));
      try {
        editorRef.current?.layout();
      } catch {}
    }, 100);
    const unlistenResized = appWindow.onResized(onResized);

    return () => {
      unlistenResized.then((fn) => fn());
      const model = editorRef.current?.getModel();
      editorRef.current?.dispose();
      model?.dispose();
      editorRef.current = null;
    };
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      disableEnforceFocus
    >
      <DialogTitle>{resolvedTitle}</DialogTitle>

      <DialogContent
        sx={{
          width: "auto",
          height: "calc(100vh - 185px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
          <BaseLoadingOverlay isLoading={isLoading} />
          {initialText !== null && (
            <MonacoEditor
              height="100%"
              path={modelPath}
              language={language}
              defaultValue={initialText}
              theme={themeMode === "light" ? "light" : "vs-dark"}
              options={{
                automaticLayout: true,
                tabSize: ["yaml", "javascript", "css"].includes(language)
                  ? 2
                  : 4,
                minimap: {
                  enabled: document.documentElement.clientWidth >= 1500,
                },
                mouseWheelZoom: true,
                readOnly,
                readOnlyMessage: {
                  value: t("profiles.modals.editor.messages.readOnly"),
                },
                renderValidationDecorations: "on",
                quickSuggestions: {
                  strings: true,
                  comments: true,
                  other: true,
                },
                padding: {
                  top: 33,
                },
                fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
                  getSystem() === "windows" ? ", twemoji mozilla" : ""
                }`,
                fontLigatures: false,
                smoothScrolling: true,
              }}
              beforeMount={beforeMount}
              onMount={onMount}
              onChange={handleChange}
            />
          )}
        </div>

        <ButtonGroup
          variant="contained"
          sx={{ position: "absolute", left: "14px", bottom: "8px" }}
        >
          <IconButton
            size="medium"
            color="inherit"
            sx={{ display: readOnly ? "none" : "" }}
            title={t("profiles.page.importForm.actions.paste")}
            disabled={isLoading}
            onClick={() => handlePaste()}
          >
            <ContentPasteRounded fontSize="inherit" />
          </IconButton>
          <IconButton
            size="medium"
            color="inherit"
            sx={{ display: readOnly ? "none" : "" }}
            title={t("profiles.modals.editor.actions.format")}
            disabled={isLoading}
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
            onClick={() =>
              appWindow
                .toggleMaximize()
                .then(() =>
                  appWindow
                    .isMaximized()
                    .then((maximized) => setIsMaximized(maximized)),
                )
                .finally(() => {
                  try {
                    editorRef.current?.layout();
                  } catch {}
                })
            }
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
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={isLoading || !canSave}
          >
            {t("shared.actions.save")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
