import mergeSchema from "@/assets/schema/clash-verge-merge-json-schema.json";
import metaSchema from "@/assets/schema/meta-json-schema.json";
import * as monaco from "monaco-editor";
import { configureMonacoYaml, JSONSchema } from "monaco-yaml";
import pac from "types-pac/pac.d.ts?raw";
import { getTemplate } from "./cmds";
import { t } from "i18next";

export interface GenerateProps {
  monacoInstance: monaco.editor.IStandaloneCodeEditor;
  languages: string[];
  isPacScript?: boolean;
  showCondition: (uriPath: string) => boolean;
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

// PAC definition
const registerPacFunctionLib = () => {
  monaco.languages.typescript.javascriptDefaults.addExtraLib(pac, "pac.d.ts");
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
    languages,
    isPacScript,
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
  return monaco.languages.registerCodeLensProvider(languages, {
    provideCodeLenses(model, token) {
      const uriPath = model.uri.path;
      if (!showCondition(uriPath)) {
        return null;
      }
      let nextType = uriPath.includes("merge.yaml") ? "merge" : "script";
      let nextLanguage = uriPath.includes("merge.yaml") ? "yaml" : "javascript";
      if (isPacScript) {
        nextType = "pac";
        nextLanguage = "javascript";
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
              arguments: [nextType, nextLanguage],
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
  monaco,
  registerPacFunctionLib,
  registerPacCompletion,
  generateTemplate,
};
