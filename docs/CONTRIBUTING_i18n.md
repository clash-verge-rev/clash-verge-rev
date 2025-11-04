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
- Test translations in a local dev build before opening a PR.
- Reference related issues and explain any context for translations or changes.

Notes

- The script expects simple top-level JSON key/value maps in each locale file.
- `.bak` snapshots are created automatically when applying fixes; remove them once you confirm the changes.
- Alignment keeps key order stable across locales, which makes reviews easier.

## Locale Key Structure Guidelines

- **Top-level scope** — Map each locale namespace to a route-level feature or domain module, mirroring folder names in `src/pages`/`src/services`. Prefer plural nouns for resource pages (`profiles`, `connections`) and reuse existing slugs where possible (`home`, `settings`).
- **Common strings** — Put reusable actions, statuses, and units in `common.*`. Before adding a new key elsewhere, check whether an equivalent entry already lives under `common`.
- **Feature layout** — Inside a namespace, group strings by their UI role using consistent buckets such as `page`, `actions`, `labels`, `tooltips`, `notifications`, `errors`, and `placeholders`. Avoid duplicating the same bucket at multiple levels.
- **Components and dialogs** — When a feature needs component-specific copy, nest it under `components.<ComponentName>` or `dialogs.<DialogName>` instead of leaking implementation names like `proxyTunCard`.
- **Naming style** — Use lower camelCase for keys, align with the feature’s UI wording, and keep names semantic (`systemProxy` rather than `switch1`). Reserve template placeholders for dynamic values (e.g., `{{name}}`).
- **Example**

```json
{
  "profiles": {
    "page": {
      "title": "Profiles",
      "description": "Manage subscription sources"
    },
    "actions": {
      "import": "Import"
    },
    "notifications": {
      "importSuccess": "Profile imported successfully"
    },
    "components": {
      "batchDialog": {
        "title": "Batch Operations"
      }
    }
  }
}
```

Reuse shared verbs (e.g., “New”, “Save”) directly from `common.actions.*` in the application code rather than duplicating them inside feature namespaces.

## Feedback & Contributions

- For tool usage issues or feedback: please open an Issue in this repository so it can be tracked and addressed.
- For localization contributions (translations, fixes, context notes, etc.): submit a PR or Issue in this repository and include examples, context, and testing instructions when possible.
- If you need help or a review, leave a comment on your submission requesting assistance.
