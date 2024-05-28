import { defineConfig } from "vite";
import path from "path";
import svgr from "vite-plugin-svgr";
import react from "@vitejs/plugin-react";
import { babel } from "@rollup/plugin-babel";
import monacoEditor from "vite-plugin-monaco-editor";

export default defineConfig({
  root: "src",
  server: { port: 3000 },
  plugins: [
    svgr(),
    react(),
    {
      apply: "build", // apply only for build, not for serve
      ...babel({
        babelHelpers: "bundled",
        extensions: [".js", ".jsx", ".ts", ".tsx"],
        targets: {
          edge: "109", // last version to support Windows 7
          safari: "13", // macOS 10.15 Catalina
        },
      }),
    },
    monacoEditor({
      languageWorkers: ["editorWorkerService", "typescript", "css"],
      customWorkers: [
        {
          label: "yaml",
          entry: "monaco-yaml/yaml.worker",
        },
      ],
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
