#!/usr/bin/env bash
# no-console.sh - block app-code console.log calls before a push.
# Zero dependencies; safe to call from Husky or CI.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/no-console.sh [path ...]

Scan application source files for console.log(...) calls. Exits 1 when any
call is found, printing "file:line:source" for each one. With no arguments,
the default application directories of this repository are scanned.

Ignored by design: dependencies, build output, test/mock files, and tooling
under scripts/, e2e/ and reports/ (those legitimately print to the console).

Environment:
  NO_CONSOLE_SKIP=1   Bypass the guard (emergency use only; prints a warning).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${NO_CONSOLE_SKIP:-0}" == "1" ]]; then
  printf 'no-console: SKIPPED (NO_CONSOLE_SKIP=1)\n' >&2
  exit 0
fi

DEFAULT_PATHS=(app src backend shared packages services workers mobile sdks plugins bin config)
paths=()
if (( $# > 0 )); then
  paths=("$@")
else
  for candidate in "${DEFAULT_PATHS[@]}"; do
    [[ -d "$candidate" ]] && paths+=("$candidate")
  done
fi

if (( ${#paths[@]} == 0 )); then
  printf 'no-console: no application paths to scan\n'
  exit 0
fi

# Written with character classes so this script never matches itself.
pattern='console[[:space:]]*\.[[:space:]]*log[[:space:]]*\('

mapfile -d '' files < <(
  find "${paths[@]}" \( -type f -o -type l \) \
    \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \
       -o -name '*.mjs' -o -name '*.cjs' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -path '*/build/*' \
    -not -path '*/coverage/*' \
    -not -path '*/.expo/*' \
    -not -path '*/__tests__/*' \
    -not -path '*/__mocks__/*' \
    -not -path '*/scripts/*' \
    -not -path '*/e2e/*' \
    -not -path '*/reports/*' \
    -not -name '*.test.*' \
    -not -name '*.spec.*' \
    -print0 2>/dev/null || true
)

failures=0
shown=0
for file in "${files[@]}"; do
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    failures=$((failures + 1))
    if (( shown < 50 )); then
      printf 'no-console: %s\n' "$hit"
      shown=$((shown + 1))
    fi
  done < <(grep -HnE "$pattern" "$file" 2>/dev/null || true)
done

if (( failures > 0 )); then
  if (( failures > shown )); then
    printf 'no-console: ... and %d more\n' "$((failures - shown))"
  fi
  printf 'no-console: %d console.log call(s) found; use the project logger instead.\n' \
    "$failures" >&2
  exit 1
fi

printf 'no-console: clean (%d file(s) scanned)\n' "${#files[@]}"
exit 0
