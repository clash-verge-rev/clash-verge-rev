import mergeSchema from "@/assets/schema/clash-verge-merge-json-schema.json";
import metaSchema from "@/assets/schema/meta-json-schema.json";
import * as monaco from "monaco-editor";
import { configureMonacoYaml, JSONSchema } from "monaco-yaml";
import pac from "types-pac/pac.d.ts?raw";

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

export default monaco;
