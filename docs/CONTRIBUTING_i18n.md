# CONTRIBUTING — i18n

Thank you for considering contributing to our localization work — your help is appreciated.

## Quick workflow

- Start small: fix typos, improve phrasing, or refine tone and consistency.
- Use `scripts/cleanup-unused-i18n.mjs` (see below) to keep locale files aligned and free of dead keys.
- Prefer incremental PRs or draft PRs; leave a comment on the issue if you want guidance.
- Open an issue to report missing strings, UI context, or localization bugs.
- Add or improve docs and tests to make future contributions easier.

## Locale maintenance script

The repository ships with `scripts/cleanup-unused-i18n.mjs`, a TypeScript-aware analyzer that:

- Scans `src/` and `src-tauri/` for `t("...")` usages (including dynamic prefixes) to identify which locale keys are referenced.
- Reports unused keys per locale and optionally removes them.
- Compares every locale against the baseline (default: `en.json`) to produce missing/extra key lists.
- Aligns locale structure/order with the baseline so diffs stay predictable.
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

Shorthand task runner aliases:

- `pnpm format:i18n` → `node scripts/cleanup-unused-i18n.mjs --align --apply`
- `pnpm node scripts/cleanup-unused-i18n.mjs -- --help` — view all flags (`--baseline`, `--src`, `--keep-extra`, `--no-backup`, `--report`, `--apply`, `--align`).

### Recommended steps before submitting translations

1. Run the script in dry-run mode to review unused/missing key output.
2. Apply removals/alignment locally if your changes introduce new keys or delete UI.
3. Inspect `.bak` backups (created by default) when applying changes to confirm nothing important disappeared.
4. For dynamic key patterns, add explicit references or update the whitelist if the script misidentifies usage.

PR checklist

- Keep JSON files UTF-8 encoded.
- Follow the repo’s locale file structure and naming conventions.
- Run `pnpm format:i18n` to align with the baseline file for minimal diffs.
- Run `pnpm i18n:validate` to ensure locale structure & namespace rules still hold.
- Test translations in a local dev build before opening a PR.
- Reference related issues and explain any context for translations or changes.

Notes

- The script expects simple top-level JSON key/value maps in each locale file.
- `.bak` snapshots are created automatically when applying fixes; remove them once you confirm the changes.
- Alignment keeps key order stable across locales, which makes reviews easier.

## Locale Key Structure Guidelines

The locale files now follow a two-namespace layout designed to mirror the React/Rust feature tree:

- **`shared.*`** — cross-cutting vocabulary (buttons, statuses, validation hints, window chrome, etc.).
  - Buckets to prefer: `actions`, `labels`, `statuses`, `messages`, `placeholders`, `units`, `validation`, `window`, `editorModes`.
- Add to `shared` only when the copy is used (or is expected to be reused) by two or more features. Otherwise keep it in the owning feature namespace.
- **`<feature>.*`** — route-level or domain-level strings scoped to a single feature.
  - Top-level keys mirror folders under `src/pages`, `src/components`, or service domains (`settings`, `proxies`, `profiles`, `home`, `unlock`, `layout`, …).
  - Within a feature namespace, prefer consistent buckets like `page`, `sections`, `forms`, `fields`, `actions`, `tooltips`, `notifications`, `errors`, `dialogs`, `tables`, `components`. Choose the minimum depth needed to describe the UI.

### Authoring guidelines

1. **Follow the shared/feature split** — before inventing a new key, check whether an equivalent exists under `shared.*`.
2. **Use camelCase leaf keys** — keep names semantic (`systemProxy`, `updateInterval`) and avoid positional names (`item1`, `btn_ok`).
3. **Group by UI responsibility** — for example:
   - `settings.dns.fields.listen`
   - `settings.dns.dialog.title`
   - `settings.dns.sections.general`
4. **Component-specific copy** — nest under `components.<ComponentName>` or `dialogs.<DialogName>` to keep implementation-specific strings organized but still discoverable.
5. **Dynamic placeholders** — continue using `{{placeholder}}` syntax and document required params in code when possible.

### Minimal example

```json
{
  "shared": {
    "actions": {
      "save": "Save",
      "cancel": "Cancel"
    }
  },
  "profiles": {
    "page": {
      "title": "Profiles",
      "actions": {
        "import": "Import",
        "updateAll": "Update All Profiles"
      },
      "notifications": {
        "importSuccess": "Profile imported successfully"
      }
    },
    "components": {
      "batchDialog": {
        "title": "Batch Operations",
        "items": "items"
      }
    }
  }
}
```

Whenever you need a common verb or label, reference `shared.*` directly in the code (`shared.actions.save`, `shared.labels.name`, …) instead of duplicating the copy in a feature namespace.

## Feedback & Contributions

- For tool usage issues or feedback: please open an Issue in this repository so it can be tracked and addressed.
- For localization contributions (translations, fixes, context notes, etc.): submit a PR or Issue in this repository and include examples, context, and testing instructions when possible.
- If you need help or a review, leave a comment on your submission requesting assistance.
