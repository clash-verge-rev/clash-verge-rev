import { defineConfig } from "vite";
import path from "path";
import svgr from "vite-plugin-svgr";
import react from "@vitejs/plugin-react";
import monaco from "vite-plugin-monaco-editor";

// https://vitejs.dev/config/
export default defineConfig({
  root: "src",
  server: { port: 3000 },
  plugins: [
    svgr(),
    react(),
    monaco({ languageWorkers: ["editorWorkerService", "typescript"] }),
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
    WIN_PORTABLE: !!process.env.VITE_WIN_PORTABLE,
  },
});
