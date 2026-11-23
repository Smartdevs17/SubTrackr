#!/usr/bin/env bash
# Install dependencies with the available package manager and start the app.
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v npm >/dev/null 2>&1; then
  PM=npm
else
  echo "Error: install pnpm or npm before running scripts/dev.sh" >&2
  exit 1
fi

echo "Using $PM"
"$PM" install
"$PM" run start
