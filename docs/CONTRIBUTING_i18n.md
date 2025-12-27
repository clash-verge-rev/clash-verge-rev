# CONTRIBUTING — i18n

Thanks for helping localize Clash Verge Rev. This guide reflects the current architecture, where the React frontend and the Tauri backend keep their translation bundles separate. Follow the steps below to keep both sides in sync without stepping on each other.

## Quick workflow

- Update the language folder under `src/locales/<lang>/`; use `src/locales/en/` as the canonical reference for keys and intent.
- Run `pnpm i18n:format` to align structure (frontend JSON + backend YAML) and `pnpm i18n:types` to refresh generated typings.
- If you touch backend copy, edit the matching YAML file in `crates/clash-verge-i18n/locales/<lang>.yml`.
- Preview UI changes with `pnpm dev` (desktop shell) or `pnpm web:dev` (web only).
- Keep PRs focused and add screenshots whenever layout could be affected by text length.

## Frontend locale structure

Each locale folder mirrors the namespaces under `src/locales/en/`:

```
src/locales/
  en/
    connections.json
    home.json
    shared.json
    ...
    index.ts
  zh/
    ...
```

- JSON files map to namespaces (for example `home.json` → `home.*`). Keep keys scoped to the file they belong to.
- `shared.json` stores reusable vocabulary (buttons, validations, etc.); feature-specific wording should live in the relevant namespace.
- `index.ts` re-exports a `resources` object that aggregates the namespace JSON files. When adding or removing namespaces, mirror the pattern from `src/locales/en/index.ts`.
- Frontend bundles are lazy-loaded by `src/services/i18n.ts`. Only languages listed in `supportedLanguages` are fetched at runtime, so append new codes there when you add a locale.

Because backend translations now live in their own directory, you no longer need to run `pnpm prebuild` just to sync locales—the frontend folder is the sole source of truth for web bundles.

## Tooling for i18n contributors

- `pnpm i18n:format` → `node scripts/cleanup-unused-i18n.mjs --align --apply`. It aligns key ordering, removes unused entries, and keeps all locales in lock-step with English across both JSON and YAML bundles.
- `pnpm i18n:check` performs a dry-run audit of frontend and backend keys. It scans TS/TSX usage plus Rust `t!(...)` calls in `src-tauri/` and `crates/` to spot missing or extra entries.
- `pnpm i18n:types` regenerates `src/types/generated/i18n-keys.ts` and `src/types/generated/i18n-resources.ts`, ensuring TypeScript catches invalid key usage.
- For dynamic keys that the analyzer cannot statically detect, add explicit references in code or update the script whitelist to avoid false positives.

## Backend (Tauri) locale bundles

Native UI strings (tray menu, notifications, dialogs) use `rust-i18n` with YAML bundles stored in `crates/clash-verge-i18n/locales/<lang>.yml`. These files are completely independent from the frontend JSON modules.

- Keep `en.yml` semantically aligned with the Simplified Chinese baseline (`zh.yml`). Other locales may temporarily copy English if no translation is available yet.
- When a backend feature introduces new strings, update every YAML file to keep the key set consistent. Missing keys fall back to the default language (`zh`), so catching gaps early avoids mixed-language output.
- The same `pnpm i18n:check` / `pnpm i18n:format` tooling now validates backend YAML keys against Rust usage, so run it after backend i18n edits.
- Rust code resolves the active language through the `clash-verge-i18n` crate (`crates/clash-verge-i18n/src/lib.rs`). No additional build step is required after editing YAML files; `tauri dev` and `tauri build` pick them up automatically.

## Adding a new language

1. Duplicate `src/locales/en/` into `src/locales/<new-lang>/` and translate the JSON files while preserving key structure.
2. Update the locale’s `index.ts` to import every namespace. Matching the English file is the easiest way to avoid missing exports.
3. Append the language code to `supportedLanguages` in `src/services/i18n.ts`.
4. If the backend should expose the language, create `crates/clash-verge-i18n/<new-lang>.yml` and translate the keys used in existing YAML files.
5. Run `pnpm i18n:format`, `pnpm i18n:types`, and (optionally) `pnpm i18n:check` in dry-run mode to confirm structure.

## Authoring guidelines

- **Reuse shared vocabulary** before introducing new phrases—check `shared.json` for common actions, statuses, and labels.
- **Prefer semantic keys** (`systemProxy`, `updateInterval`, `autoRefresh`) over positional ones (`item1`, `dialogTitle2`).
- **Document placeholders** using `{{placeholder}}` and ensure components supply the required values.
- **Group keys by UI responsibility** inside each namespace (`page`, `sections`, `forms`, `actions`, `tooltips`, `notifications`, `errors`, `tables`, `statuses`, etc.).
- **Keep strings concise** to avoid layout issues. If a translation needs more context, leave a PR note so reviewers can verify the UI.

## Testing & QA

- Launch the desktop shell with `pnpm dev` (or `pnpm web:dev`) and navigate through the affected views to confirm translations load and layouts behave.
- Run `pnpm test` if you touched code that consumes translations or adjusts formatting logic.
- For backend changes, trigger the relevant tray actions or notifications to verify the updated copy.
- Note any remaining untranslated sections or layout concerns in your PR description so maintainers can follow up.

## Feedback & support

- File an issue for missing context, tooling bugs, or localization gaps so we can track them.
- PRs that touch UI should include screenshots or GIFs whenever text length may affect layout.
- Mention the commands you ran (formatting, type generation, tests) in the PR checklist. If you need extra context or review help, request it via a PR comment.
