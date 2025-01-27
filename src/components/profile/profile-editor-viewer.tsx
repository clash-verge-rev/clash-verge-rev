import mergeSchema from "@/assets/schema/clash-verge-merge-json-schema.json";
import metaSchema from "@/assets/schema/meta-json-schema.json";
import { BaseDialog, Notice } from "@/components/base";
import { LogViewer } from "@/components/profile/log-viewer";
import { LogMessage } from "@/components/profile/profile-more";
import { useWindowSize } from "@/hooks/use-window-size";
import {
  getTemplate,
  readProfileFile,
  saveProfileFile,
  testMergeChain,
} from "@/services/cmds";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";
import {
  CheckCircleOutline,
  ErrorOutline,
  RadioButtonUnchecked,
  Terminal,
} from "@mui/icons-material";
import { Badge, BadgeProps, IconButton, styled, Tooltip } from "@mui/material";
import { useLockFn } from "ahooks";
import * as monaco from "monaco-editor";
import { configureMonacoYaml, JSONSchema } from "monaco-yaml";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const isScriptMerge = mode === "profile" && scope === "script";
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
    fetchContent.then(async (data) => {
      const dom = editorDomRef.current;

      if (!dom) return;

      if (instanceRef.current) instanceRef.current.dispose();

      const uri = monaco.Uri.parse(`${nanoid()}.${scope}.${language}`);
      const model = monaco.editor.createModel(data, language, uri);
      instanceRef.current = monaco.editor.create(dom, {
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

      if (scope && ["merge", "script"].includes(scope)) {
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
      <BaseDialog
        open={open}
        title={title ?? t("Edit File")}
        fullWidth
        cancelBtn={t("Cancel")}
        okBtn={t("Save")}
        hideOkBtn={readOnly}
        okDisabled={isScriptMerge && !scriptChecked}
        onClose={() => {
          setLogs(logInfo ?? []);
          setScriptChecked(false);
          onClose();
        }}
        onCancel={() => {
          setLogs(logInfo ?? []);
          setScriptChecked(false);
          onClose();
        }}
        onOk={() => {
          if (isScriptMerge && hasError) {
            Notice.error(t("Script Run Check Failed"));
            return;
          }
          onSave();
        }}
        contentStyle={{
          height: `${size.height - 100}px`,
          userSelect: "text",
        }}>
        <div className="flex h-full overflow-hidden">
          <div className="h-full w-full" ref={editorDomRef} />

          {isScriptMerge && (
            <div className="flex w-14 flex-col items-center justify-end space-y-2">
              <Tooltip title={t("Console")} placement="left">
                <IconButton
                  aria-label="terminal"
                  size="medium"
                  color="primary"
                  onClick={() => setLogOpen(true)}>
                  {hasError ? (
                    <Badge color="error" variant="dot">
                      <Terminal color="error" fontSize="medium" />
                    </Badge>
                  ) : (
                    <StyledBadge badgeContent={logs.length} color="primary">
                      <Terminal color="primary" fontSize="medium" />
                    </StyledBadge>
                  )}
                </IconButton>
              </Tooltip>
              <Tooltip title={t("Run Check")} placement="left">
                <IconButton
                  aria-label="test"
                  color={
                    scriptChecked ? (hasError ? "error" : "success") : "inherit"
                  }
                  size="medium"
                  sx={{}}
                  onClick={async () => {
                    const value = instanceRef.current?.getValue();
                    if (value == undefined) return;

                    const result = await testMergeChain(property, value);
                    const currentLogs = result.logs[property];
                    setLogs(currentLogs);
                    setScriptChecked(true);
                    if (currentLogs[0]?.exception) {
                      Notice.error(t("Script Run Check Failed"));
                    } else {
                      Notice.success(t("Script Run Check Successful"));
                    }
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
                </IconButton>
              </Tooltip>
            </div>
          )}
        </div>
        <LogViewer
          open={logOpen}
          logInfo={logs}
          onClose={() => setLogOpen(false)}
        />
      </BaseDialog>
    </>
  );
};
