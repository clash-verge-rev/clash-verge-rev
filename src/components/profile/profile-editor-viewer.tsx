import mergeSchema from "@/assets/schema/clash-verge-merge-json-schema.json";
import metaSchema from "@/assets/schema/meta-json-schema.json";
import { Notice } from "@/components/base";
import { LogViewer } from "@/components/profile/log-viewer";
import { useWindowSize } from "@/hooks/use-window-size";
import {
  getTemplate,
  readProfileFile,
  saveProfileFile,
  testMergeChain,
} from "@/services/cmds";
import { useThemeMode } from "@/services/states";
import { LogMessage } from "@/services/types";
import getSystem from "@/utils/get-system";
import {
  CheckCircleOutline,
  ErrorOutline,
  RadioButtonUnchecked,
  Terminal,
} from "@mui/icons-material";
import {
  Badge,
  BadgeProps,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  styled,
} from "@mui/material";
import { useLockFn } from "ahooks";
import * as monaco from "monaco-editor";
import { configureMonacoYaml, JSONSchema } from "monaco-yaml";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import pac from "types-pac/pac.d.ts?raw";

interface Props {
  title?: string | ReactNode;
  mode: "profile" | "text";
  property: string;
  open: boolean;
  readOnly?: boolean;
  language: "yaml" | "javascript" | "css";
  scope?: "clash" | "merge" | "pac" | "script";
  logInfo?: LogMessage[];
  onClose: () => void;
  onChange?: (content: string) => void;
}

const StyledBadge = styled(Badge)<BadgeProps>(({ theme }) => ({
  "& .MuiBadge-badge": {
    right: 0,
    top: 3,
    border: `2px solid ${theme.palette.background.paper}`,
    padding: "0 4px",
  },
}));

// yaml worker
configureMonacoYaml(monaco, {
  validate: true,
  enableSchemaRequest: true,
  schemas: [
    {
      uri: "http://example.com/meta-json-schema.json",
      fileMatch: ["**/*.clash.yaml"],
      schema: metaSchema as unknown as JSONSchema,
    },
    {
      uri: "http://example.com/clash-verge-merge-json-schema.json",
      fileMatch: ["**/*.merge.yaml"],
      schema: mergeSchema as unknown as JSONSchema,
    },
  ],
});
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

export const ProfileEditorViewer = (props: Props) => {
  const {
    title,
    mode,
    property,
    open,
    readOnly,
    language,
    scope,
    logInfo,
    onClose,
    onChange,
  } = props;
  const isEnhanceProfile =
    mode === "profile" && (scope === "merge" || scope === "script");
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>(logInfo ?? []);
  const { t } = useTranslation();
  const editorDomRef = useRef<any>();
  const instanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const registerCodeLensRef = useRef<any>();
  const themeMode = useThemeMode();
  const { size } = useWindowSize();
  const hasError = !!logs.find((item) => item.exception);
  const [scriptChecked, setScriptChecked] = useState(false);

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
        readOnly: readOnly, // 只读模式
        readOnlyMessage: { value: t("ReadOnlyMessage") }, // 只读模式尝试编辑时的提示信息
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

      instanceRef.current?.onDidChangeModelContent(() => {
        setScriptChecked(false);
      });

      if (scope && ["merge", "script", "pac"].includes(scope)) {
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
          ["yaml", "javascript"],
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
    <>
      <Dialog
        open={open}
        onClose={() => {
          setScriptChecked(false);
          onClose();
        }}
        maxWidth="xl"
        fullWidth>
        <DialogTitle>{title ?? t("Edit File")}</DialogTitle>

        <DialogContent
          sx={{
            width: "94%",
            height: `${size.height - 200}px`,
            pb: 1,
            userSelect: "text",
            overflow: "hidden",
          }}>
          <div style={{ width: "100%", height: "100%" }} ref={editorDomRef} />
          {isEnhanceProfile && (
            <>
              {logs.length > 0 && (
                <Fab
                  aria-label="terminal"
                  size="medium"
                  onClick={() => setLogOpen(true)}
                  sx={{ position: "absolute", bottom: "145px", right: "90px" }}>
                  {hasError ? (
                    <Badge color="error" variant="dot">
                      <Terminal color="error" fontSize="medium" />
                    </Badge>
                  ) : (
                    <StyledBadge badgeContent={logs.length} color="primary">
                      <Terminal color="primary" fontSize="medium" />
                    </StyledBadge>
                  )}
                </Fab>
              )}
              <Fab
                aria-label="test"
                color={
                  scriptChecked ? (hasError ? "error" : "success") : "inherit"
                }
                size="medium"
                sx={{ position: "absolute", bottom: "80px", right: "90px" }}
                onClick={async () => {
                  setLogs([]);
                  const value = instanceRef.current?.getValue();
                  if (value == undefined) return;

                  const result = await testMergeChain(property, value);
                  const currentLogs = result.logs[property];
                  setLogs(currentLogs);
                  setScriptChecked(true);
                  if (currentLogs[0].exception) {
                    Notice.error("This script has errors, please fix it.");
                  } else {
                    Notice.success("This script is working correctly.");
                  }
                  // if (currentLogs.length > 0) {
                  //   setTimeout(() => {
                  //     setLogOpen(true);
                  //   }, 500);
                  // }
                }}>
                {scriptChecked ? (
                  hasError ? (
                    <ErrorOutline fontSize="medium" />
                  ) : (
                    <CheckCircleOutline fontSize="medium" />
                  )
                ) : (
                  <RadioButtonUnchecked fontSize="medium" />
                )}
              </Fab>
            </>
          )}
        </DialogContent>

        <DialogActions>
          {/* {isEnhanceProfile && (
            <>
              <LoadingButton
                variant="contained"
                loading={false}
                onClick={async () => {
                  const result = await getPreMergeResult(property);
                  console.log("pre-merge result", result.config);
                  instanceRef.current?.setValue(result.config);
                }}>
                {t("Preview pre-merge")}
              </LoadingButton>
              <LoadingButton
                variant="contained"
                loading={false}
                onClick={async () => {
                  const content = instanceRef.current?.getValue();
                  if (content == undefined) return;
                  const result = await testMergeChain(property, content);
                  console.log("cur-merge result", result.config);
                  instanceRef.current?.setValue(result.config);
                }}>
                {t("Preview current-merge")}
              </LoadingButton>
              <LoadingButton
                variant="contained"
                loading={false}
                onClick={async () => {
                  setLogs([]);
                  const value = instanceRef.current?.getValue();
                  if (value == undefined) return;

                  const result = await testMergeChain(property, value);
                  const currentLogs = result.logs[property];
                  setLogs(currentLogs);
                  if (currentLogs.length > 0) {
                    setLogOpen(true);
                  }
                }}>
                {t("Test")}
              </LoadingButton>
            </>
          )} */}
          <Button
            onClick={() => {
              setScriptChecked(false);
              onClose();
            }}
            variant={readOnly ? "contained" : "outlined"}>
            {t("Cancel")}
          </Button>
          {readOnly ? null : (
            <Button
              onClick={onSave}
              disabled={!scriptChecked || hasError}
              variant="contained">
              {t("Save")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <LogViewer
        open={logOpen}
        logInfo={logs}
        onClose={() => setLogOpen(false)}
      />
    </>
  );
};
