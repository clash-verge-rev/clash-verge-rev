import js from "@eslint/js";
import configPrettier from "eslint-config-prettier";
import pluginImportX from "eslint-plugin-import-x";
import pluginPrettier from "eslint-plugin-prettier";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],

    plugins: {
      js,
      "react-hooks": pluginReactHooks,
      // @ts-expect-error -- https://github.com/un-ts/eslint-plugin-import-x/issues/421
      "import-x": pluginImportX,
      "react-refresh": pluginReactRefresh,
      "unused-imports": pluginUnusedImports,
      prettier: pluginPrettier,
    },

    extends: [
      "js/recommended",
      tseslint.configs.recommended,
      eslintReact.configs["recommended-typescript"],
      configPrettier,
    ],

    languageOptions: {
      globals: globals.browser,
    },

    settings: {
      react: {
        version: "detect",
      },
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: "./tsconfig.json",
        }),
      ],
    },

    rules: {
      // React
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",

      // unused-imports 代替 no-unused-vars
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_+$",
          args: "after-used",
          argsIgnorePattern: "^_+$",
        },
      ],

      // Import
      "import-x/no-unresolved": "error",
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      // 其他常见
      "prefer-const": "warn",
      "no-case-declarations": "error",
      "no-fallthrough": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],

      // Prettier 格式化问题
      "prettier/prettier": "warn",
    },
  },
]);
