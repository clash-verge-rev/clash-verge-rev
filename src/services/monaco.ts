import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { configureMonacoYaml } from "monaco-yaml";
import pac from "types-pac/pac.d.ts?raw";

import yamlWorker from "@/utils/yaml.worker?worker";

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

// Work around https://github.com/remcohaszing/monaco-yaml/issues/272.
const patchCreateWebWorker = () => {
  const oldCreateWebWorker = monaco.editor.createWebWorker;

  monaco.editor.createWebWorker = (
    options: monaco.IWebWorkerOptions | monaco.editor.IInternalWebWorkerOptions,
  ) => {
    if ("worker" in options) {
      return oldCreateWebWorker(options);
    }

    return monaco.createWebWorker(options);
  };
};

let mounted = false;

export const beforeEditorMount = () => {
  if (mounted) return;

  patchCreateWebWorker();

  monaco.typescript.javascriptDefaults.addExtraLib(pac, "pac.d.ts");

  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
    completion: true,
  });

  mounted = true;
};
