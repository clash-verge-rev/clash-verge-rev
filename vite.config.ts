import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import react from "@vitejs/plugin-react";
import monaco from "vite-plugin-monaco-editor";

// https://vitejs.dev/config/
export default defineConfig({
  root: "src",
  plugins: [svgr(), react(), monaco()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
