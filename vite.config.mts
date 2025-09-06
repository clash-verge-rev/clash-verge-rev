import { defineConfig } from "vite";
import path from "path";
import svgr from "vite-plugin-svgr";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import monacoEditorPlugin, {
  type IMonacoEditorOpts,
} from "vite-plugin-monaco-editor";
const monacoEditorPluginDefault = (monacoEditorPlugin as any).default as (
  options: IMonacoEditorOpts,
) => any;

export default defineConfig({
  root: "src",
  server: { port: 3000 },
  plugins: [
    svgr(),
    react(),
    legacy({
      targets: ["edge>=109", "safari>=13"],
      renderLegacyChunks: false,
      modernPolyfills: true,
      additionalModernPolyfills: [
        "core-js/modules/es.object.has-own.js",
        "core-js/modules/web.structured-clone.js",
        path.resolve("./src/polyfills/matchMedia.js"),
        path.resolve("./src/polyfills/WeakRef.js"),
        path.resolve("./src/polyfills/RegExp.js"),
      ],
    }),
    monacoEditorPluginDefault({
      languageWorkers: ["editorWorkerService", "typescript", "css"],
      customWorkers: [
        {
          label: "yaml",
          entry: "monaco-yaml/yaml.worker",
        },
      ],
      globalAPI: false,
    }),
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    minify: "terser",
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
    sourcemap: false,
    cssCodeSplit: true,
    cssMinify: true,
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ["console.debug", "console.trace"],
        dead_code: true,
        unused: true,
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      treeshake: {
        preset: "recommended",
        moduleSideEffects: (id) => !id.endsWith(".css"),
        tryCatchDeoptimization: false,
      },
      output: {
        compact: true,
        experimentalMinChunkSize: 100000,
        dynamicImportInCjs: true,
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Monaco Editor should be a separate chunk
            if (id.includes("monaco-editor")) return "monaco-editor";

            // React core libraries
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("react-router-dom")
            ) {
              return "react-core";
            }

            // React UI libraries
            if (
              id.includes("react-transition-group") ||
              id.includes("react-error-boundary") ||
              id.includes("react-hook-form") ||
              id.includes("react-markdown") ||
              id.includes("react-virtuoso")
            ) {
              return "react-ui";
            }

            // Material UI libraries (grouped together)
            if (
              id.includes("@mui/material") ||
              id.includes("@mui/icons-material") ||
              id.includes("@mui/lab") ||
              id.includes("@mui/x-data-grid")
            ) {
              return "mui";
            }

            // Tauri-related plugins: grouping together Tauri plugins
            if (
              id.includes("@tauri-apps/api") ||
              id.includes("@tauri-apps/plugin-clipboard-manager") ||
              id.includes("@tauri-apps/plugin-dialog") ||
              id.includes("@tauri-apps/plugin-fs") ||
              id.includes("@tauri-apps/plugin-global-shortcut") ||
              id.includes("@tauri-apps/plugin-notification") ||
              id.includes("@tauri-apps/plugin-process") ||
              id.includes("@tauri-apps/plugin-shell") ||
              id.includes("@tauri-apps/plugin-updater")
            ) {
              return "tauri-plugins";
            }

            // Utilities chunk: group commonly used utility libraries
            if (
              id.includes("axios") ||
              id.includes("lodash-es") ||
              id.includes("dayjs") ||
              id.includes("js-base64") ||
              id.includes("js-yaml") ||
              id.includes("cli-color") ||
              id.includes("nanoid")
            ) {
              return "utils";
            }

            // Group other vendor packages together to reduce small chunks
            const pkg = id.match(/node_modules\/([^/]+)/)?.[1];
            if (pkg) {
              // Large packages get their own chunks
              if (
                pkg.includes("monaco") ||
                pkg.includes("lodash") ||
                pkg.includes("antd") ||
                pkg.includes("emotion")
              ) {
                return `vendor-${pkg}`;
              }

              // Group all other packages together
              return "vendor";
            }
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
    OS_PLATFORM: '"unknown"',
  },
});
