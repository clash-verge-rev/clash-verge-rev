import path from "node:path";
import { fileURLToPath } from "node:url";

import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(CONFIG_DIR, "src");

const getPackageName = (id: string) => {
  // Walk through possible pnpm virtual paths and nested node_modules, return the last package segment.
  const matches = [
    ...id.matchAll(
      /node_modules\/(?:\.pnpm\/[^/]+\/)?(?:node_modules\/)?((?:@[^/]+\/)?[^/]+)/g,
    ),
  ];
  const last = matches.at(-1);
  return last ? last[1] : null;
};

const getSemanticNameFromFacade = (
  facadeModuleId: string | null | undefined,
) => {
  if (!facadeModuleId) return null;

  const cleanPath = facadeModuleId.split("?")[0];
  const relativePath = path.relative(SRC_ROOT, cleanPath);
  if (relativePath.startsWith("..")) return null;

  const withoutExtension = relativePath.replace(/\.[^/.]+$/, "");
  const normalizedPath = withoutExtension.replace(/\\/g, "/");
  const withoutTrailingIndex = normalizedPath.endsWith("/index")
    ? normalizedPath.slice(0, -"/index".length)
    : normalizedPath;

  const semanticName = withoutTrailingIndex
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");

  return semanticName || "index";
};

const normalizeEntryName = (name: string, isEntry?: boolean) =>
  isEntry && name === "index" ? "main" : name;

const getSemanticNameFromChunk = (chunkInfo: {
  facadeModuleId: string | null | undefined;
  moduleIds?: string[];
  name: string;
  isEntry?: boolean;
}) => {
  const fromFacade = getSemanticNameFromFacade(chunkInfo.facadeModuleId);
  if (fromFacade) return normalizeEntryName(fromFacade, chunkInfo.isEntry);

  if (Array.isArray(chunkInfo.moduleIds)) {
    for (const moduleId of chunkInfo.moduleIds) {
      const semantic = getSemanticNameFromFacade(moduleId);
      if (semantic) return normalizeEntryName(semantic, chunkInfo.isEntry);
    }
  }

  return normalizeEntryName(chunkInfo.name, chunkInfo.isEntry);
};

const normalizePackageName = (pkg: string) =>
  pkg.replace(/^@/, "").replace(/[@/]/g, "-");

type ChunkMatchContext = { id: string; pkg: string | null };
type ChunkRule = {
  name: string | ((pkg: string) => string);
  match: (ctx: ChunkMatchContext) => boolean;
};

const CHUNK_PACKAGE_SETS: Record<string, ReadonlySet<string>> = {
  "react-core": new Set([
    "react",
    "react-dom",
    "react-router",
    "@remix-run/router",
    "scheduler",
    "loose-envify",
    "object-assign",
    "use-sync-external-store",
    "use-sync-external-store/shim",
  ]),
  "react-ui": new Set([
    "react-transition-group",
    "react-error-boundary",
    "react-hook-form",
    "react-markdown",
    "react-virtuoso",
  ]),
  utils: new Set([
    "axios",
    "lodash-es",
    "dayjs",
    "js-base64",
    "js-yaml",
    "cli-color",
    "nanoid",
  ]),
};

const NAMESPACE_CHUNK_PREFIXES: Array<{ name: string; prefixes: string[] }> = [
  { name: "mui", prefixes: ["@mui/"] },
  { name: "tauri-plugins", prefixes: ["@tauri-apps/"] },
];

const LARGE_VENDOR_MATCHERS = [
  "@emotion/react",
  "@emotion/styled",
  "@emotion/cache",
  "lodash",
  "monaco",
  "@dnd-kit",
  "i18next",
];

const packageSetRules: ChunkRule[] = Object.entries(CHUNK_PACKAGE_SETS).map(
  ([name, pkgSet]) => ({
    name,
    match: ({ pkg }) => !!pkg && pkgSet.has(pkg),
  }),
);

const namespaceRules: ChunkRule[] = NAMESPACE_CHUNK_PREFIXES.map(
  ({ name, prefixes }) => ({
    name,
    match: ({ pkg }) =>
      !!pkg && prefixes.some((prefix) => pkg.startsWith(prefix)),
  }),
);

const chunkRules: ChunkRule[] = [
  { name: "monaco-editor", match: ({ id }) => id.includes("monaco-editor") },
  ...packageSetRules,
  ...namespaceRules,
  {
    name: (pkg) => `vendor-${normalizePackageName(pkg ?? "vendor")}`,
    match: ({ pkg }) =>
      !!pkg && LARGE_VENDOR_MATCHERS.some((keyword) => pkg.includes(keyword)),
  },
];
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
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    minify: "terser",
    chunkSizeWarningLimit: 4500,
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
        dynamicImportInCjs: true,
        entryFileNames: (chunkInfo) => {
          const semanticName = getSemanticNameFromChunk(chunkInfo);

          return `assets/${semanticName}-[hash].js`;
        },
        chunkFileNames: (chunkInfo) => {
          const semanticName = getSemanticNameFromChunk(chunkInfo);

          return `assets/${semanticName}-[hash].js`;
        },
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          const pkg = getPackageName(id);
          const ctx: ChunkMatchContext = { id, pkg };
          for (const rule of chunkRules) {
            if (rule.match(ctx)) {
              return typeof rule.name === "function"
                ? rule.name(pkg ?? "vendor")
                : rule.name;
            }
          }

          return "vendor";
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
});
