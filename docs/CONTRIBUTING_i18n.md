# CONTRIBUTING — i18n

Thank you for considering contributing to our localization work — your help is appreciated.

Quick overview

- cvr-i18 is a CLI that helps manage simple top-level JSON locale files:
  - Detect duplicated top-level keys
  - Find keys missing versus a base file (default: en.json)
  - Export missing entries for translators
  - Reorder keys to match the base file for predictable diffs
  - Operate on a directory or a single file

Get the CLI (No binary provided yet)

```bash
git clone https://github.com/clash-verge-rev/clash-verge-rev-i18n-cli
cd clash-verge-rev-i18n-cli
cargo install --path .
# or
cargo install --git https://github.com/clash-verge-rev/clash-verge-rev-i18n-cli
```

Common commands

- Show help: `cvr-i18`
- Directory (auto-detects `./locales` or `./src/locales`): `cvr-i18 -d /path/to/locales`
- Check duplicates: `cvr-i18 -k`
- Check missing keys: `cvr-i18 -m`
- Export missing keys: `cvr-i18 -m -e ./exports`
- Sort keys to base file: `cvr-i18 -s`
- Use a base file: `cvr-i18 -b base.json`
- Single file: `cvr-i18 -f locales/zh.json`

Options (short)

- `-d, --directory <DIR>`
- `-f, --file <FILE>`
- `-k, --duplicated-key`
- `-m, --missing-key`
- `-e, --export <DIR>`
- `-s, --sort`
- `-b, --base <FILE>`

Exit codes

- `0` — success (no issues)
- `1` — issues found (duplicates/missing)
- `2` — error (IO/parse/runtime)

How to contribute (recommended steps)

- Start small: fix typos, improve phrasing, or refine tone and consistency.
- Run the CLI against your locale files to detect duplicates or missing keys.
- Export starter JSONs for translators with `-m -e <DIR>`.
- Prefer incremental PRs or draft PRs; leave a comment on the issue if you want guidance.
- Open an issue to report missing strings, UI context, or localization bugs.
- Add or improve docs and tests to make future contributions easier.

PR checklist

- Keep JSON files UTF-8 encoded.
- Follow the repo’s locale file structure and naming conventions.
- Reorder keys to match the base file (`-s`) for minimal diffs.
- Test translations in a local dev build before opening a PR.
- Reference related issues and explain any context for translations or changes.

Notes

- The tool expects simple top-level JSON key/value maps.
- Exported JSONs are starter files for translators (fill in values, keep keys).
- Sorting keeps diffs consistent and reviewable.

Repository
https://github.com/clash-verge-rev/clash-verge-rev-i18n-cli

## Feedback & Contributions

- For tool usage issues or feedback: please open an Issue in the [repository](https://github.com/clash-verge-rev/clash-verge-rev-i18n-cli) so it can be tracked and addressed.
- For localization contributions (translations, fixes, context notes, etc.): submit a PR or Issue in this repository and include examples, context, and testing instructions when possible.
- If you need help or a review, leave a comment on your submission requesting assistance.
