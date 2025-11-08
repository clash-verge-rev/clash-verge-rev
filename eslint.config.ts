import eslintJS from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import { defineConfig } from "eslint/config";
import configPrettier from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import pluginImportX from "eslint-plugin-import-x";
import pluginPrettier from "eslint-plugin-prettier";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],

    plugins: {
      js: eslintJS,
      // @ts-expect-error -- https://github.com/typescript-eslint/typescript-eslint/issues/11543
      "react-hooks": pluginReactHooks,
      // @ts-expect-error -- https://github.com/un-ts/eslint-plugin-import-x/issues/421
      "import-x": pluginImportX,
      "react-refresh": pluginReactRefresh,
      "unused-imports": pluginUnusedImports,
      prettier: pluginPrettier,
    },

    extends: [
      eslintJS.configs.recommended,
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

      "@eslint-react/no-forward-ref": "off",

      // React performance and production quality rules
      "@eslint-react/no-array-index-key": "warn",
      "@eslint-react/no-children-count": "error",
      "@eslint-react/no-children-for-each": "error",
      "@eslint-react/no-children-map": "error",
      "@eslint-react/no-children-only": "error",
      "@eslint-react/no-children-prop": "error",
      "@eslint-react/no-children-to-array": "error",
      "@eslint-react/no-class-component": "error",
      "@eslint-react/no-clone-element": "error",
      "@eslint-react/no-create-ref": "error",
      "@eslint-react/no-default-props": "error",
      "@eslint-react/no-direct-mutation-state": "error",
      "@eslint-react/no-implicit-key": "error",
      "@eslint-react/no-prop-types": "error",
      "@eslint-react/no-set-state-in-component-did-mount": "error",
      "@eslint-react/no-set-state-in-component-did-update": "error",
      "@eslint-react/no-set-state-in-component-will-update": "error",
      "@eslint-react/no-string-refs": "error",
      "@eslint-react/no-unstable-context-value": "warn",
      "@eslint-react/no-unstable-default-props": "warn",
      "@eslint-react/no-unused-class-component-members": "error",
      "@eslint-react/no-unused-state": "error",
      "@eslint-react/no-useless-fragment": "warn",
      "@eslint-react/prefer-destructuring-assignment": "warn",

      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",

      // unused-imports 代替 no-unused-vars
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^ignore",
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
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "scripts-workflow/**/*.{js,mjs,cjs}"],

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
]);
