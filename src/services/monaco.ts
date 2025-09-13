import { t } from "i18next";
import { configureMonacoYaml, type JSONSchema } from "monaco-yaml";
import pac from "types-pac/pac.d.ts?raw";
import { getTemplate } from "./cmds";
import type { editor } from "monaco-editor";

// 延迟加载 Monaco Editor
let monacoInstance: typeof import("monaco-editor") | null = null;

export const loadMonaco = async () => {
  if (!monacoInstance) {
    monacoInstance = await import("monaco-editor");
  }
  return monacoInstance;
};

// 缓存配置
let yamlConfigured = false;
let pacLibRegistered = false;
let pacCompletionRegistered = false;

// YAML configuration editor
export const configureYaml = async () => {
  if (yamlConfigured) return;

  const monaco = await loadMonaco();
  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
    schemas: [
      {
        uri: "http://example.com/meta-json-schema.json",
        fileMatch: ["**/*.clash.yaml*"],
        schema: import(
          "meta-json-schema/schemas/meta-json-schema.json"
        ) as unknown as JSONSchema,
      },
      {
        uri: "http://example.com/clash-verge-merge-json-schema.json",
        fileMatch: ["**/*.merge.yaml*"],
        schema: import(
          "meta-json-schema/schemas/clash-verge-merge-json-schema.json"
        ) as unknown as JSONSchema,
      },
    ],
  });

  yamlConfigured = true;
};

export const defaultOptions: editor.IStandaloneEditorConstructionOptions = {
  tabSize: 2,
  theme: "light",
  minimap: { enabled: true },
  mouseWheelZoom: true,
  readOnlyMessage: { value: t("ReadOnlyMessage") },
  renderValidationDecorations: "on",
  quickSuggestions: {
    strings: true,
    comments: true,
    other: true,
  },
  automaticLayout: true,
  fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji", "twemoji mozilla"`,
  fontLigatures: true,
  smoothScrolling: true,
};

// PAC definition
export const registerPacFunctionLib = async () => {
  if (pacLibRegistered) return;

  const monaco = await loadMonaco();
  let disposable = monaco.languages.typescript.javascriptDefaults.addExtraLib(
    pac,
    "pac.d.ts",
  );

  pacLibRegistered = true;
  return disposable;
};

export const registerPacCompletion = async () => {
  if (pacCompletionRegistered) return;

  const monaco = await loadMonaco();
  let disposable = monaco.languages.registerCompletionItemProvider(
    "javascript",
    {
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
    },
  );

  pacCompletionRegistered = true;
  return disposable;
};

export interface GenerateProps {
  monacoInstance: editor.IStandaloneCodeEditor;
  languageSelector: string[];
  generateType: "merge" | "script" | "pac";
  generateLanguage: "yaml" | "javascript";
  showCondition: boolean;
  onGenerateSuccess?: () => void;
}

export const generateTemplate = async (props: GenerateProps) => {
  const {
    monacoInstance,
    languageSelector,
    generateType,
    generateLanguage,
    showCondition,
    onGenerateSuccess,
  } = props;

  const monaco = await loadMonaco();

  // 生成模板的命令方法
  const generateCommand = monacoInstance.addCommand(
    0,
    (_, scope: string, language: string) => {
      getTemplate(scope, language).then((templateContent) => {
        monacoInstance.setValue(templateContent);
        onGenerateSuccess?.();
      });
    },
    "",
  );

  // 增强脚本模板生成
  return monaco.languages.registerCodeLensProvider(languageSelector, {
    provideCodeLenses(model, token) {
      if (!showCondition || model.isDisposed()) {
        return null;
      }

      return {
        lenses: [
          {
            id: "Regenerate Template Content",
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 2,
              endColumn: 1,
            },
            command: {
              id: generateCommand!,
              title: t("Regenerate Template Content"),
              arguments: [generateType, generateLanguage],
            },
          },
        ],
        dispose: () => {},
      };
    },
    resolveCodeLens(_model, codeLens, _token) {
      return codeLens;
    },
  });
};
