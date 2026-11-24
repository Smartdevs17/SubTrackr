#!/usr/bin/env bash
# Repo-wide typecheck entrypoint with incremental Turbo cache when available.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/typecheck.sh [--dir PATH] [--help]

Run the repository TypeScript typecheck through Turbo when installed,
otherwise fall back to the package manager script.

Options:
  --dir PATH   Project root (default: current directory)
  --help       Show this help
Environment:
  TYPECHECK_SKIP=1   Skip the check (intended for CI bootstrapping only)
EOF
}

project_dir="."
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) project_dir="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "typecheck: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$project_dir"

if [[ "${TYPECHECK_SKIP:-}" == "1" ]]; then
  echo "typecheck: skipped via TYPECHECK_SKIP=1" >&2
  exit 0
fi

if [[ ! -f package.json ]]; then
  echo "typecheck: no package.json found in $(pwd)" >&2
  exit 2
fi

if [[ -x node_modules/.bin/turbo ]]; then
  echo "typecheck: turbo incremental cache enabled (task=typecheck)"
  exec node_modules/.bin/turbo run typecheck
fi

if command -v pnpm >/dev/null 2>&1; then
  runner="pnpm"
elif command -v npm >/dev/null 2>&1; then
  runner="npm"
else
  echo "typecheck: no supported package manager found (pnpm/npm)" >&2
  exit 2
fi

echo "typecheck: turbo not installed; falling back to $runner run typecheck"
exec "$runner" run typecheck
