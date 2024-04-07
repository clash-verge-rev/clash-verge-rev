import { defineConfig } from "vite";
import path from "path";
import svgr from "vite-plugin-svgr";
import react from "@vitejs/plugin-react";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";

const isObjectWithDefaultFunction = (
  module: unknown
): module is { default: typeof monacoEditorPluginModule } =>
  module != null &&
  typeof module === "object" &&
  "default" in module &&
  typeof module.default === "function";

const monacoEditorPlugin = isObjectWithDefaultFunction(monacoEditorPluginModule)
  ? monacoEditorPluginModule.default
  : monacoEditorPluginModule;

// https://vitejs.dev/config/
export default defineConfig({
  root: "src",
  server: { port: 3000 },
  plugins: [
    svgr(),
    react(),
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService", "typescript"],
    }),
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve("./src"),
      "@root": path.resolve("."),
    },
  },
  define: {
    OS_PLATFORM: `"${process.platform}"`,
  },
});
