#!/usr/bin/env bash

set -euo pipefail

# Packages the Soroban contract source for explorer verification.
# Output: dist/subtrackr-contract-source-<timestamp>.tar.gz
#
# Includes:
# - contracts/Cargo.toml
# - contracts/{proxy,storage,subscription,types}/**
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
if [ -f "$CONTRACTS_DIR/Cargo.lock" ]; then
  cp "$CONTRACTS_DIR/Cargo.lock" "$TMP_DIR/contracts/Cargo.lock"
fi

cp -R "$CONTRACTS_DIR/proxy" "$TMP_DIR/contracts/proxy"
cp -R "$CONTRACTS_DIR/storage" "$TMP_DIR/contracts/storage"
cp -R "$CONTRACTS_DIR/subscription" "$TMP_DIR/contracts/subscription"
cp -R "$CONTRACTS_DIR/types" "$TMP_DIR/contracts/types"

# If compiled WASMs exist, compute checksums and include metadata
WASM_DIR="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release"
WASM_LIST=(
  "subtrackr_proxy.wasm"
  "subtrackr_storage.wasm"
  "subtrackr_subscription.wasm"
)

FOUND=0
for WASM in "${WASM_LIST[@]}"; do
  if [ -f "$WASM_DIR/$WASM" ]; then
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo "📦 Found compiled WASMs. Computing checksums..."
  : > "$TMP_DIR/contracts/WASM_SHA256.txt"
  for WASM in "${WASM_LIST[@]}"; do
    if [ -f "$WASM_DIR/$WASM" ]; then
      (cd "$WASM_DIR" && (sha256sum "$WASM" || shasum -a 256 "$WASM") >> "$TMP_DIR/contracts/WASM_SHA256.txt")
    fi
  done
fi

echo "🗜️  Creating archive: $OUT"
(cd "$TMP_DIR" && tar -czf "$OUT" .)

rm -rf "$TMP_DIR"
echo "✅ Source package created at: $OUT"
