#!/bin/bash
# Deploy Stellar testnet contracts for the sandbox instance
# Called by the orchestrator after container provisioning

set -euo pipefail

SANDBOX_ID="${1:-}"
STELLAR_ACCOUNT="${2:-}"

if [ -z "$SANDBOX_ID" ] || [ -z "$STELLAR_ACCOUNT" ]; then
  echo "Usage: $0 <sandbox_id> <stellar_account>"
  exit 1
fi

echo "Deploying contracts for sandbox $SANDBOX_ID using account $STELLAR_ACCOUNT"

CONTRACTS_DIR="/workspace/contracts"

# Build contracts
echo "Building contracts..."
cd "$CONTRACTS_DIR"
cargo build --release 2>&1

# Deploy subscription contract
echo "Deploying subscription contract..."
stellar contract deploy \
  --wasm target/release/subtrackr_subscription.wasm \
  --source "$STELLAR_ACCOUNT" \
  --network testnet \
  --alias "subscription_${SANDBOX_ID}" 2>&1

# Deploy billing contract
echo "Deploying billing contract..."
stellar contract deploy \
  --wasm target/release/subtrackr_billing.wasm \
  --source "$STELLAR_ACCOUNT" \
  --network testnet \
  --alias "billing_${SANDBOX_ID}" 2>&1

echo "Contracts deployed successfully for sandbox $SANDBOX_ID"
