import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monaco from "vite-plugin-monaco-editor";

// https://vitejs.dev/config/
export default defineConfig({
  root: "src",
  plugins: [react(), monaco()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
