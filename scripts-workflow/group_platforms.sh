#!/usr/bin/env bash
set -euo pipefail

# group_platforms.sh — lock platform entries into platform subsections.
#
# Inside every <details> section of Changelog.md, entries whose platform
# mentions form a set of one or two platforms (Windows/macOS/Linux) are
# grouped under a bold heading named by that set (e.g. **macOS/Linux**),
# ordered Windows -> macOS -> Linux. Entries naming all three or none stay
# in the common area above the headings. Idempotent.
#
# usage: group_platforms.sh [--check]
#   (default) rewrite Changelog.md in place
#   --check   report misplaced entries without writing; exit 1 if any

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="$ROOT_DIR/Changelog.md"

if [ ! -f "$CHANGELOG" ]; then
	echo "Error: $CHANGELOG not found" >&2
	exit 2
fi

regrouped=$(awk '
  { lines[NR] = $0 }
  END {
    n = NR; i = 1
    while (i <= n) {
      if (lines[i] ~ /^<details>$/) {
        j = i
        while (j < n && lines[j] !~ /^<\/details>$/) j++
        emit_block(i, j)
        i = j + 1
      } else {
        print lines[i]
        i++
      }
    }
  }

  function platform_of(l,   c, key) {
    c = 0; key = ""
    if (l ~ /Windows/) { c++; key = key "Windows/" }
    if (l ~ /macOS/)   { c++; key = key "macOS/" }
    if (l ~ /Linux/)   { c++; key = key "Linux/" }
    if (c == 0 || c == 3) return ""
    sub(/\/$/, "", key)
    return key
  }

  function heading(kk,   t) {
    t = kk
    gsub(/Windows/, "🖥️", t)
    gsub(/macOS/, "🍎", t)
    gsub(/Linux/, "🐧", t)
    return "**" t " " kk "**"
  }

  function emit_block(a, b,   k, m, n, x, oi, kk, nkeys, order, count, entries) {
    split("", count); split("", entries)

    print lines[a]
    k = a + 1
    if (lines[k] ~ /^<summary>/) { print lines[k]; k++ }
    print ""

    for (m = k; m < b; m++) {
      l = lines[m]
      if (l !~ /^- /) continue
      p = platform_of(l)
      # increment must not live inside the subscript expression:
      # BSD awk parses `++count[p]` there as two unary pluses
      n = ++count[p]
      entries[p SUBSEP n] = l
    }

    for (x = 1; x <= count[""]; x++) print entries["" SUBSEP x]
    nkeys = split("Windows macOS Linux Windows/macOS Windows/Linux macOS/Linux", order, " ")
    for (oi = 1; oi <= nkeys; oi++) {
      kk = order[oi]
      if (!count[kk]) continue
      print ""
      print heading(kk)
      print ""
      for (x = 1; x <= count[kk]; x++) print entries[kk SUBSEP x]
    }
    print ""
    print lines[b]
  }
' "$CHANGELOG")

if [ "${1:-}" = "--check" ]; then
  if [ "$regrouped" = "$(cat "$CHANGELOG")" ]; then
    echo "OK: platform grouping is up to date"
    exit 0
  fi
  echo "Misplaced platform entries detected. Diff (current -> regrouped):"
  diff "$CHANGELOG" <(printf '%s\n' "$regrouped") || true
  exit 1
fi

before=$(grep -c '^- ' "$CHANGELOG" || true)
after=$(printf '%s\n' "$regrouped" | grep -c '^- ' || true)
if [ "$before" != "$after" ]; then
  echo "Error: regrouping would drop entries ($before -> $after); refusing to write" >&2
  exit 4
fi

printf '%s\n' "$regrouped" > "$CHANGELOG"
echo "Regrouped platform entries in $CHANGELOG"
