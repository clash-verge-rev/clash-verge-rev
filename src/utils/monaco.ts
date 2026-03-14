import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import yamlWorker from "monaco-yaml/yaml.worker?worker";

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

loader.init().catch((error) => {
  console.error("[monaco] Monaco initialization failed:", error);
});
