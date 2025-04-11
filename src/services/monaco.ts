import mergeSchema from "@/assets/schema/clash-verge-merge-json-schema.json";
import metaSchema from "@/assets/schema/meta-json-schema.json";
import { t } from "i18next";
import * as monaco from "monaco-editor";
import { configureMonacoYaml, JSONSchema } from "monaco-yaml";
import pac from "types-pac/pac.d.ts?raw";
import { getTemplate } from "./cmds";

export interface GenerateProps {
  monacoInstance: monaco.editor.IStandaloneCodeEditor;
  languageSelector: string[];
  generateType: "merge" | "script" | "pac";
  generateLanguage: "yaml" | "javascript";
  showCondition: boolean;
  onGenerateSuccess?: () => void;
}

// YAML configuration editor
configureMonacoYaml(monaco, {
  validate: true,
  enableSchemaRequest: true,
  schemas: [
    {
      uri: "http://example.com/meta-json-schema.json",
      fileMatch: ["**/*.clash.yaml*"],
      schema: metaSchema as unknown as JSONSchema,
    },
    {
      uri: "http://example.com/clash-verge-merge-json-schema.json",
      fileMatch: ["**/*.merge.yaml*"],
      schema: mergeSchema as unknown as JSONSchema,
    },
  ],
});

const defaultOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
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
const registerPacFunctionLib = () => {
  return monaco.languages.typescript.javascriptDefaults.addExtraLib(
    pac,
    "pac.d.ts",
  );
};

const registerPacCompletion = () => {
  return monaco.languages.registerCompletionItemProvider("javascript", {
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
};

const generateTemplate = (props: GenerateProps) => {
  const {
    monacoInstance,
    languageSelector,
    generateType,
    generateLanguage,
    showCondition,
    onGenerateSuccess,
  } = props;
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
      const uriPath = model.uri.path;
      if (!showCondition) {
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
    resolveCodeLens(model, codeLens, token) {
      return codeLens;
    },
  });
};

export {
  defaultOptions,
  generateTemplate,
  monaco,
  registerPacCompletion,
  registerPacFunctionLib,
};
