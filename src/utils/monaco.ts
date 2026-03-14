import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { configureMonacoYaml } from "monaco-yaml";
import yamlWorker from "monaco-yaml/yaml.worker?worker";
import pac from "types-pac/pac.d.ts?raw";

self.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case "css":
      case "less":
      case "scss":
        return new cssWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      case "yaml":
        return new yamlWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

let hasConfiguredMonaco = false;

export const configureMonacoOnce = () => {
  if (hasConfiguredMonaco) return;

  monaco.typescript.javascriptDefaults.addExtraLib(pac, "pac.d.ts");

  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
  });

  hasConfiguredMonaco = true;
};

loader.init().catch((error) => {
  console.error("[monaco] Monaco initialization failed:", error);
});
