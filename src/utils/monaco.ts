import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import yamlWorker from "monaco-yaml/yaml.worker?worker";

if (typeof self !== "undefined") {
  const globalScope = self as typeof self & {
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker;
    };
  };

  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
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
}

loader.config({ monaco });

void loader.init().catch((error: unknown) => {
  console.error("[monaco] Monaco initialization failed:", error);
});
