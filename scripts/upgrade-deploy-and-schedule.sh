#!/bin/bash

# SubTrackr Upgrade Script
# Builds & deploys a new implementation, then schedules an upgrade on the proxy.
#
# Usage:
#   export SOROBAN_ACCOUNT="your-identity"
#   export ADMIN_ADDRESS="G..."
#   ./scripts/upgrade-deploy-and-schedule.sh <PROXY_ID> <NETWORK> [EXECUTE_AFTER]
#
# Notes:
# - If EXECUTE_AFTER is omitted, the proxy's configured upgrade delay is used via `authorize_upgrade`.
# - If EXECUTE_AFTER is provided, `schedule_upgrade` is used directly.

source "$(dirname "$0")/utils.sh"

set -e

check_command "soroban"
check_command "cargo"

validate_env "SOROBAN_ACCOUNT"
validate_env "ADMIN_ADDRESS"

PROXY_ID=$1
NETWORK=$2
EXECUTE_AFTER=${3:-}

if [ -z "$PROXY_ID" ] || [ -z "$NETWORK" ]; then
  print_error "Usage: ./scripts/upgrade-deploy-and-schedule.sh <PROXY_ID> <NETWORK> [EXECUTE_AFTER]"
  exit 1
fi

print_status "Building implementation contract..."
cd contracts
cargo build --target wasm32-unknown-unknown --release -p subtrackr-subscription
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/subtrackr_subscription.wasm

print_status "Deploying new implementation to $NETWORK..."
NEW_IMPLEMENTATION_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/subtrackr_subscription.optimized.wasm \
  --source "$SOROBAN_ACCOUNT" \
  --network "$NETWORK")

print_success "New implementation deployed! ID: $NEW_IMPLEMENTATION_ID"

print_status "Scheduling upgrade on proxy: $PROXY_ID"
if [ -n "$EXECUTE_AFTER" ]; then
  soroban contract invoke \
    --id "$PROXY_ID" \
    --source "$SOROBAN_ACCOUNT" \
    --network "$NETWORK" \
    -- schedule_upgrade \
    --implementation "$NEW_IMPLEMENTATION_ID" \
    --execute_after "$EXECUTE_AFTER"
else
  soroban contract invoke \
    --id "$PROXY_ID" \
    --source "$SOROBAN_ACCOUNT" \
    --network "$NETWORK" \
    -- authorize_upgrade \
    --admin "$ADMIN_ADDRESS" \
    --new_implementation "$NEW_IMPLEMENTATION_ID"
fi

print_success "Upgrade scheduled."
print_status "Next: wait for timelock, then execute: ./scripts/upgrade-execute.sh $PROXY_ID $NEW_IMPLEMENTATION_ID $NETWORK"

