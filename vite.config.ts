import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";
import svgr from "vite-plugin-svgr";

const isObjectWithDefaultFunction = (
  module: unknown,
): module is { default: typeof monacoEditorPluginModule } =>
  module != null &&
  typeof module === "object" &&
  "default" in module &&
  typeof module.default === "function";

const monacoEditorPlugin = isObjectWithDefaultFunction(monacoEditorPluginModule)
  ? monacoEditorPluginModule.default
  : monacoEditorPluginModule;

const devtools = () => {
  return {
    name: "react-devtools",
    transformIndexHtml(html: string) {
      return html.replace(
        `<head>`,
        `<head>
    <script src="http://localhost:8097"></script>`,
      );
    },
  };
};

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  return {
    root: "src",
    // prevent vite from obscuring rust errors
    clearScreen: false,
    // Tauri expects a fixed port, fail if that port is not available
    server: {
      port: 5173,
      strictPort: true,
    },
    envPrefix: [
      "VITE_",
      "TAURI_PLATFORM",
      "TAURI_ARCH",
      "TAURI_FAMILY",
      "TAURI_PLATFORM_VERSION",
      "TAURI_PLATFORM_TYPE",
      "TAURI_DEBUG",
    ],
    plugins: [
      svgr(),
      react(),
      legacy({
        renderLegacyChunks: false,
        modernTargets: ["edge>=109", "safari>=13"],
        modernPolyfills: true,
        additionalModernPolyfills: [
          "core-js/modules/es.object.has-own.js",
          "core-js/modules/web.structured-clone.js",
          path.resolve("./src/polyfills/matchMedia.js"),
          path.resolve("./src/polyfills/WeakRef.js"),
          path.resolve("./src/polyfills/RegExp.js"),
        ],
      }),
      monacoEditorPlugin({
        languageWorkers: ["editorWorkerService", "css", "typescript", "css"],
        customWorkers: [
          {
            label: "yaml",
            entry: "monaco-yaml/yaml.worker",
          },
        ],
      }),
      isDev && devtools(),
    ],
    build: {
      outDir: "../dist",
      emptyOutDir: true,
      // Tauri uses Chromium on Windows and WebKit on macOS and Linux
      target:
        process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
      // don't minify for debug builds
      minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
      // 为调试构建生成源代码映射 (sourcemap)
      sourcemap: !!process.env.TAURI_DEBUG,
      rollupOptions: {
        input: {
          splashscreen: path.resolve(__dirname, "src/splashscreen.html"),
          main: path.resolve(__dirname, "src/index.html"),
        },
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules")) {
              if (id.includes("monaco-editor")) {
                return "monaco-editor";
              }
              return "vendor";
            } else if (id.includes("src/components")) {
              return "verge-components";
            }
          },
        },
      },
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
  };
});
