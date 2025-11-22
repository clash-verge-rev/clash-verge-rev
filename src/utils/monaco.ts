import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import yamlWorker from "monaco-yaml/yaml.worker?worker";

type WorkerConstructor = new () => Worker;

// Align with the former plugin mapping so Monaco can resolve its background workers.
const workerConstructors: Record<string, WorkerConstructor> = {
  editorWorkerService: editorWorker,
  typescript: tsWorker,
  javascript: tsWorker,
  "languages.typescript": tsWorker,
  css: cssWorker,
  less: cssWorker,
  scss: cssWorker,
  "languages.css": cssWorker,
  yaml: yamlWorker,
};

const defaultWorker = workerConstructors.editorWorkerService;

if (typeof window !== "undefined") {
  const globalScope = self as typeof self & {
    MonacoEnvironment?: {
      getWorker: (moduleId: string, label: string) => Worker;
    };
  };

  const getWorker = (_moduleId: string, label: string) => {
    const WorkerCtor = workerConstructors[label] ?? defaultWorker;
    return new WorkerCtor();
  };

  globalScope.MonacoEnvironment = {
    ...globalScope.MonacoEnvironment,
    getWorker,
  };
}
