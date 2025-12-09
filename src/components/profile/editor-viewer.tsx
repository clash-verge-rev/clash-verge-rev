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
import { ReactNode, useEffect, useRef, useState } from "react";
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
  // Initial content loader: prefer passing a stable function. A plain Promise is supported,
  // but it won't trigger background refreshes and should be paired with a stable `dataKey`.
  initialData: Promise<string> | (() => Promise<string>);
  // Logical document id; reloads when this or language changes.
  dataKey?: string | number;
  readOnly?: boolean;
  language: T;
  onChange?: (prev?: string, curr?: string) => void;
  onSave?: (prev?: string, curr?: string) => void | Promise<void>;
  onClose: () => void;
}

let initialized = false;
const monacoInitialization = () => {
  if (initialized) return;

  // YAML worker setup
  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
  });
  // PAC type definitions for JS suggestions
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

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(undefined);
  const prevData = useRef<string | undefined>("");
  const currData = useRef<string | undefined>("");
  // Hold the latest loader without making effects depend on its identity
  const initialDataRef = useRef<Props<T>["initialData"]>(initialData);
  // Track mount/open state to prevent setState after unmount/close
  const isMountedRef = useRef(true);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [initialText, setInitialText] = useState<string | null>(null);
  const [modelPath, setModelPath] = useState<string>("");
  const modelChangeDisposableRef = useRef<monaco.IDisposable | null>(null);
  // Unique per-component instance id to avoid shared Monaco models across dialogs
  const instanceIdRef = useRef<string>(nanoid());
  // Disable actions while loading or before modelPath is ready
  const isLoading = initialText === null || !modelPath;
  // Track if background refresh failed; offer a retry action in UI
  const [refreshFailed, setRefreshFailed] = useState<unknown | null>(null);
  // Skip the first background refresh triggered by [open, modelPath, dataKey]
  // to avoid double-invoking the loader right after the initial load.
  const skipNextRefreshRef = useRef(false);
  // Monotonic token to cancel stale background refreshes
  const reloadTokenRef = useRef(0);
  // Track whether the editor has a usable baseline (either loaded or fallback).
  // This avoids saving before the model/path are ready, while still allowing recovery
  // when the initial load fails but an empty buffer is presented.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Editor should only be read-only when explicitly requested by prop.
  // A refresh/load failure must not lock the editor to allow manual recovery.
  const effectiveReadOnly = readOnly;
  // Keep ref in sync with prop without triggering loads
  useEffect(() => {
    initialDataRef.current = initialData;
  }, [initialData]);
  // Background refresh: when the dialog/model is ready and the underlying resource key changes,
  // try to refresh content (only if user hasn't typed). Do NOT depend on `initialData` function
  // identity because callers often pass inline lambdas that change every render.
  useEffect(() => {
    if (!open) return;
    // Only attempt after initial model is ready to avoid racing the initial load
    if (!modelPath) return;
    // Avoid immediate double-load on open: the initial load has just completed.
    if (skipNextRefreshRef.current) {
      skipNextRefreshRef.current = false;
      return;
    }
    // Only meaningful when a callable loader is provided (plain Promise cannot be "recalled")
    if (typeof initialDataRef.current === "function") {
      void reloadLatest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modelPath, dataKey]);
  // Helper to (soft) reload latest source and apply only if the user hasn't typed yet
  const reloadLatest = useLockFn(async () => {
    // Snapshot the model/doc identity and bump a token so older calls can't win
    const myToken = ++reloadTokenRef.current;
    const expectedModelPath = modelPath;
    const expectedKey = dataKey;
    if (isMountedRef.current && openRef.current) {
      // Clear previous error (UI hint) at the start of a new attempt
      setRefreshFailed(null);
    }
    try {
      const src = initialDataRef.current;
      const promise =
        typeof src === "function"
          ? (src as () => Promise<string>)()
          : (src ?? Promise.resolve(""));
      const next = await promise;
      // Abort if component/dialog state changed meanwhile:
      // - unmounted or closed
      // - document switched (modelPath/dataKey no longer match)
      // - a newer reload was started
      if (
        !isMountedRef.current ||
        !openRef.current ||
        expectedModelPath !== modelPath ||
        expectedKey !== dataKey ||
        myToken !== reloadTokenRef.current
      ) {
        return;
      }
      // Only update when untouched and value changed
      const userUntouched = currData.current === prevData.current;
      if (userUntouched && next !== prevData.current) {
        prevData.current = next;
        currData.current = next;
        editorRef.current?.setValue(next);
      }
      // Ensure any previous error state is cleared after a successful refresh
      if (isMountedRef.current && openRef.current) {
        setRefreshFailed(null);
      }
      // If we previously failed to load, a successful refresh establishes a valid baseline
      if (isMountedRef.current && openRef.current) {
        setHasLoadedOnce(true);
      }
    } catch (err) {
      // Only report if still mounted/open and this call is the latest
      if (
        isMountedRef.current &&
        openRef.current &&
        myToken === reloadTokenRef.current
      ) {
        setRefreshFailed(err ?? true);
        showNotice.error(
          "shared.feedback.notifications.common.refreshFailed",
          err,
        );
      }
    }
  });

  const beforeMount = () => {
    monacoInitialization();
  };

  // Prepare initial content and a stable model path for monaco-react
  /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Clear state up-front to avoid showing stale content while loading
    setInitialText(null);
    setModelPath("");
    // Clear any stale refresh error when starting a new load
    setRefreshFailed(null);
    // Reset initial-load success flag on open/start
    setHasLoadedOnce(false);
    // We will perform an explicit initial load below; skip the first background refresh.
    skipNextRefreshRef.current = true;
    prevData.current = undefined;
    currData.current = undefined;

    (async () => {
      try {
        const dataSource = initialDataRef.current;
        const dataPromise =
          typeof dataSource === "function"
            ? (dataSource as () => Promise<string>)()
            : (dataSource ?? Promise.resolve(""));
        const data = await dataPromise;
        if (cancelled) return;
        prevData.current = data;
        currData.current = data;

        setInitialText(data);
        // Build a stable model path and avoid "undefined" in the name
        const pathParts = [String(dataKey ?? nanoid()), instanceIdRef.current];
        pathParts.push(language);

        setModelPath(pathParts.join("."));
        // Successful initial load should clear any previous refresh error flag
        setRefreshFailed(null);
        // Mark that we have a valid baseline content
        setHasLoadedOnce(true);
      } catch (err) {
        if (cancelled) return;
        // Notify the error and still show an empty editor so the user isn't stuck
        showNotice.error(err);

        // Align refs with fallback text after a load failure
        prevData.current = "";
        currData.current = "";

        setInitialText("");
        const pathParts = [String(dataKey ?? nanoid()), instanceIdRef.current];
        pathParts.push(language);

        setModelPath(pathParts.join("."));
        // Mark refresh failure so users can retry
        setRefreshFailed(err ?? true);
        // Initial load failed; keep `hasLoadedOnce` false to prevent accidental save
        // of an empty buffer. It will be enabled on successful refresh or first edit.
        setHasLoadedOnce(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dataKey, language]);
  /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */

  const onMount = async (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    // Dispose previous model when switching (monaco-react creates a fresh model when `path` changes)
    modelChangeDisposableRef.current?.dispose();
    modelChangeDisposableRef.current = editor.onDidChangeModel((e) => {
      if (e.oldModelUrl) {
        const oldModel = monaco.editor.getModel(e.oldModelUrl);
        oldModel?.dispose();
      }
    });
    // No refresh on mount; doing so would double-load.
    // Background refreshes are handled by the [open, modelPath, dataKey] effect.
  };

  const handleChange = useLockFn(async (value?: string) => {
    try {
      currData.current = value ?? editorRef.current?.getValue();
      onChange?.(prevData.current, currData.current);
      // If the initial load failed, allow saving after the user makes an edit.
      if (!hasLoadedOnce) {
        setHasLoadedOnce(true);
      }
    } catch (err) {
      showNotice.error(err);
    }
  });

  const handleSave = useLockFn(async () => {
    try {
      // Disallow saving if initial content never loaded successfully to avoid accidental overwrite
      if (!readOnly && hasLoadedOnce) {
        // Guard: if the editor/model hasn't mounted, bail out
        if (!editorRef.current) {
          return;
        }
        currData.current = editorRef.current.getValue();
        if (onSave) {
          await onSave(prevData.current, currData.current);
          // If save succeeds, align prev with current
          prevData.current = currData.current;
        }
      }
      onClose();
    } catch (err) {
      showNotice.error(err);
    }
  });

  // Explicit paste action: works even when Monaco's context-menu paste cannot read clipboard.
  const handlePaste = useLockFn(async () => {
    try {
      if (!editorRef.current || effectiveReadOnly) return;
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const editor = editorRef.current;
      const model = editor.getModel();
      const selections = editor.getSelections();
      if (!model || !selections || selections.length === 0) return;
      // Group edits to allow single undo step
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
      // Ensure Monaco recalculates layout after window resize/maximize/restore.
      // automaticLayout is not always sufficient when the parent dialog resizes.
      try {
        editorRef.current?.layout();
      } catch {}
    }, 100);
    const unlistenResized = appWindow.onResized(onResized);

    return () => {
      unlistenResized.then((fn) => fn());
      // Clean up editor and model to avoid leaks
      const model = editorRef.current?.getModel();
      editorRef.current?.dispose();
      model?.dispose();
      modelChangeDisposableRef.current?.dispose();
      modelChangeDisposableRef.current = null;
      editorRef.current = undefined;
    };
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{resolvedTitle}</DialogTitle>

      <DialogContent
        sx={{
          width: "auto",
          // Give the editor a scrollable height (even in nested dialogs)
          height: "calc(100vh - 185px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
          {/* Show overlay while loading or until modelPath is ready */}
          <BaseLoadingOverlay isLoading={isLoading} />
          {/* Background refresh failure helper */}
          {!!refreshFailed && (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 10,
                zIndex: 2,
                display: "flex",
                gap: 8,
                alignItems: "center",
                pointerEvents: "auto",
              }}
            >
              <span
                style={{
                  color: "var(--mui-palette-warning-main, #ed6c02)",
                  background: "rgba(237,108,2,0.1)",
                  border: "1px solid rgba(237,108,2,0.35)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 12,
                  lineHeight: "20px",
                  userSelect: "text",
                }}
              >
                {t("shared.feedback.notifications.common.refreshFailed")}
              </span>
              <Button
                size="small"
                variant="outlined"
                onClick={() => reloadLatest()}
              >
                {t("shared.actions.retry")}
              </Button>
            </div>
          )}
          {initialText !== null && modelPath && (
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
                readOnly: effectiveReadOnly,
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
                  top: 33, // Top padding to prevent snippet overlap
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
                  // Nudge a layout in case the resize event batching lags behind
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
            disabled={isLoading || !hasLoadedOnce}
          >
            {t("shared.actions.save")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
