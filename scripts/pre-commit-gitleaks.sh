#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

run_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    gitleaks detect --source . --staged --config .gitleaks.toml --baseline .gitleaks.baseline.toml
  elif command -v npx >/dev/null 2>&1; then
    npx gitleaks detect --source . --staged --config .gitleaks.toml --baseline .gitleaks.baseline.toml
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$REPO_ROOT":/repo -w /repo zricethezav/gitleaks:latest detect --source . --staged --config .gitleaks.toml --baseline .gitleaks.baseline.toml
  else
    echo "Error: gitleaks CLI is not installed, and Docker is unavailable."
    echo "Install gitleaks or Docker to enable the pre-commit secret scan."
    return 1
  fi
}

run_gitleaks
