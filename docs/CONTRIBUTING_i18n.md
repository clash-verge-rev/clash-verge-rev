# CONTRIBUTING — i18n

Thank you for contributing to Clash Verge Rev localization! This guide reflects the current project layout and tooling so you can land translation improvements smoothly.

## Quick workflow

- Focus fixes on the language folders inside `src/locales/<lang>/` and use `src/locales/en/` as the baseline for key shape and intent.
- Keep pull requests small and open draft PRs early if you would like feedback.
- Run `pnpm format:i18n` to align JSON structure and `pnpm i18n:types` to refresh generated typings before pushing.
- Preview changes with `pnpm dev` (desktop shell) or `pnpm web:dev` (web only) to verify context and layout.
- Report missing context, untranslated UI strings, or script bugs via issues so we can track them.

## Locale layout

Every language lives in its own directory:

```
src/locales/
  en/
    connections.json
    home.json
    …
    shared.json
    tests.json
    index.ts
  zh/
    …
```

- Each JSON file maps to a namespace (`home` → `home.*`, `shared` → `shared.*`, etc.). Keep keys scoped to their file.
- `shared.json` stores reusable copy (buttons, labels, validation messages). Feature-specific content remains in the relevant namespace file (`profiles.json`, `settings.json`, …).
- `index.ts` re-exports a `resources` object that aggregates the namespace JSON. When adding files, mirror the pattern used in `src/locales/en/index.ts`.
- Do **not** edit `src-tauri/resources/locales`; those files are copied from `src/locales` during packaging by `pnpm prebuild`.
- Rust/Tauri uses a separate set of YAML bundles in `src-tauri/locales/` for system tray text and native notifications. Update those when backend-facing strings change.

## Locale maintenance script

The repository ships with `scripts/cleanup-unused-i18n.mjs`, a TypeScript-aware analyzer that:

- Scans `src/` and `src-tauri/` for `t("...")` usage (including dynamic prefixes) to determine which keys are referenced.
- Compares locales to the baseline (`en`) to list missing or extra keys.
- Optionally removes unused keys and aligns key ordering/structure.
- Emits optional JSON reports for CI or manual review.

### Typical commands

```bash
# Dry-run audit (recommended before opening a PR)
pnpm node scripts/cleanup-unused-i18n.mjs

# Apply removals and align to the baseline structure (same as pnpm format:i18n)
pnpm node scripts/cleanup-unused-i18n.mjs --apply --align

# Generate a machine-readable report
pnpm node scripts/cleanup-unused-i18n.mjs --report ./i18n-report.json
```

Aliases and flags:

- `pnpm format:i18n` → `node scripts/cleanup-unused-i18n.mjs --align --apply`
- `pnpm node scripts/cleanup-unused-i18n.mjs -- --help` shows all options (`--baseline`, `--src`, `--keep-extra`, `--no-backup`, `--report`, `--apply`, `--align`, …).

### Before submitting translations

1. Run the script in dry-run mode to inspect missing/unused keys.
2. Apply alignment if you added or removed keys so diffs stay minimal.
3. Review `.bak` backups (generated when `--apply` runs) to ensure important strings were not removed; delete the backups once confirmed.
4. For dynamic keys, add explicit references in code or update the script whitelist so the analyzer recognizes them.

## Typings & runtime integration

- `pnpm i18n:types` regenerates `src/types/generated/i18n-keys.ts` and `src/types/generated/i18n-resources.ts`. Run it whenever keys change so TypeScript enforces valid usages.
- Supported runtime languages are defined in `src/services/i18n.ts`. Update the `supportedLanguages` array when you add an additional locale.
- The app defaults to Chinese (`zh`) and lazily loads other bundles. If a bundle fails to load, it falls back to `zh`.
- Packing (`pnpm build`, `pnpm prebuild`) copies `src/locales` into `src-tauri/resources/locales` so keep the source tree authoritative.
- Backend (Tauri) strings such as tray menu labels and native notifications use the YAML bundles under `src-tauri/locales/<lang>.yml` via `rust-i18n`. Keep the English file (`en.yml`) aligned with the Simplified Chinese semantics and mirror updates across the remaining languages (繁體 `zhtw` translates the Chinese copy; other locales can temporarily duplicate English until translators step in).
- When adding a new language to the backend, create a matching `<lang>.yml` in `src-tauri/locales/`, populate the keys used in the existing files, and ensure `src/services/i18n.ts` includes the language code so the frontend can request it.

## Adding a new language

1. Duplicate `src/locales/en/` into `src/locales/<new-lang>/` (match the folder name to the language code you intend to serve, e.g. `pt-br`).
2. Translate the JSON files while preserving the key hierarchy. `shared.json` should stay aligned with the baseline.
3. Update the new locale’s `index.ts` to import every JSON namespace (use the English file as reference).
4. Append the language code to `supportedLanguages` in `src/services/i18n.ts`. Adjust `crowdin.yml` if the locale code needs a mapping.
5. Run `pnpm format:i18n`, `pnpm i18n:types`, and optionally `pnpm node scripts/cleanup-unused-i18n.mjs` (dry-run) to verify structure.
6. Execute `pnpm dev` to confirm UI translations load, and `pnpm prebuild` if you want to double-check Tauri resource syncing.

## Authoring guidelines

- **Reuse shared vocabulary**: before creating a new label, check `shared.json` (`actions`, `labels`, `statuses`, `placeholders`, `validation`, `window`, `editorModes`, etc.). Only introduce feature-specific copy when it is unique to that area.
- **Keep keys semantic**: use camelCase leaves that describe intent (`systemProxy`, `updateInterval`, `autoRefresh`). Avoid positional keys like `item1` or `dialogTitle2`.
- **Organize by UI responsibility** inside each namespace. Common buckets include:
  - `page`, `sections`, `forms`, `fields`, `actions`, `tooltips`, `notifications`, `errors`, `dialogs`, `tables`, `components`, `statuses`.
- **Document dynamic placeholders**: continue using the `{{placeholder}}` syntax and ensure code comments/context explain required parameters.
- **Example structure** (from `src/locales/en/home.json`):

```json
{
  "page": {
    "title": "Home",
    "tooltips": {
      "settings": "Home Settings"
    }
  },
  "components": {
    "proxyTun": {
      "status": {
        "systemProxyEnabled": "System Proxy Enabled"
      }
    }
  }
}
```

## Testing & QA

- Launch the desktop shell with `pnpm dev` (or `pnpm web:dev` for browser-only checks) to confirm strings display correctly and spacing still works in the UI.
- Run `pnpm test` if you touched code that relies on translations or formatting logic.
- Note uncovered scenarios or language-specific concerns (pluralization, truncated text) in your PR description.

## Feedback & support

- Open an issue for tooling problems, missing context, or translation bugs so we can track them.
- For localization contributions (translations, fixes, context notes, etc.), submit a PR with screenshots when layout changes might be impacted.
- If you need a second pair of eyes, leave a comment on your PR and the team will follow up.
