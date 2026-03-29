#!/usr/bin/env bash

set -euo pipefail

# Packages the Soroban contract source for explorer verification.
# Output: dist/subtrackr-contract-source-<timestamp>.tar.gz
#
# Includes:
# - contracts/Cargo.toml
# - contracts/src/**
# - WASM hash (if built) for reference
#
# Usage:
#   ./scripts/package-source.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
DIST_DIR="$ROOT_DIR/dist"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$DIST_DIR/subtrackr-contract-source-$TS.tar.gz"

mkdir -p "$DIST_DIR"

echo "🔧 Preparing source package..."
TMP_DIR="$(mktemp -d)"
mkdir -p "$TMP_DIR/contracts"

cp "$CONTRACTS_DIR/Cargo.toml" "$TMP_DIR/contracts/Cargo.toml"
mkdir -p "$TMP_DIR/contracts/src"
cp -R "$CONTRACTS_DIR/src/"* "$TMP_DIR/contracts/src/"

# If a compiled wasm exists, compute checksums and include metadata
WASM_PATH="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/contracts.wasm"
if [ -f "$WASM_PATH" ]; then
  echo "📦 Found compiled WASM. Computing checksums..."
  (cd "$CONTRACTS_DIR" && \
    sha256sum "$WASM_PATH" > "$TMP_DIR/contracts/WASM_SHA256.txt" || shasum -a 256 "$WASM_PATH" > "$TMP_DIR/contracts/WASM_SHA256.txt")
fi

echo "🗜️  Creating archive: $OUT"
(cd "$TMP_DIR" && tar -czf "$OUT" .)

rm -rf "$TMP_DIR"
echo "✅ Source package created at: $OUT"

