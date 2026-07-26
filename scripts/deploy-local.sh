#!/bin/bash

# SubTrackr Local Deployment Script
# Deploys smart contracts to a local Soroban network

# Source utility functions
source "$(dirname "$0")/utils.sh"

set -e

print_status "🚀 Starting local deployment..."

# Check prerequisites
check_command "soroban"
check_command "cargo"

# Build and optimize contract
print_status "Building and optimizing contracts..."
cd contracts

# Build all Soroban contracts (proxy + storage + implementation)
cargo build --target wasm32-unknown-unknown --release \
  -p subtrackr-proxy \
  -p subtrackr-storage \
  -p subtrackr-subscription

PROXY_WASM="target/wasm32-unknown-unknown/release/subtrackr_proxy.wasm"
STORAGE_WASM="target/wasm32-unknown-unknown/release/subtrackr_storage.wasm"
IMPLEMENTATION_WASM="target/wasm32-unknown-unknown/release/subtrackr_subscription.wasm"

print_status "Optimizing WASM artifacts..."
soroban contract optimize --wasm "$STORAGE_WASM"
soroban contract optimize --wasm "$IMPLEMENTATION_WASM"
soroban contract optimize --wasm "$PROXY_WASM"

# Deploy to local network
# Assumes a local network is running and an identity 'alice' exists
print_status "Deploying to local network..."
STORAGE_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_storage.optimized.wasm \
    --source alice \
    --network local)

IMPLEMENTATION_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_subscription.optimized.wasm \
    --source alice \
    --network local)

PROXY_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_proxy.optimized.wasm \
    --source alice \
    --network local)

print_success "Storage deployed successfully! ID: $STORAGE_ID"
print_success "Implementation deployed successfully! ID: $IMPLEMENTATION_ID"
print_success "Proxy deployed successfully! ID: $PROXY_ID"

# Initialize contract
# Use alice as admin for local testing
print_status "Initializing contract..."
soroban contract invoke \
    --id "$PROXY_ID" \
    --source alice \
    --network local \
    -- initialize \
    --admin alice \
    --storage "$STORAGE_ID" \
    --implementation "$IMPLEMENTATION_ID" \
    --upgrade_delay_secs 0 \
    --rollback_delay_secs 0

print_success "Contract initialized successfully!"
cat > .env.local <<EOF
PROXY_ID=$PROXY_ID
STORAGE_ID=$STORAGE_ID
IMPLEMENTATION_ID=$IMPLEMENTATION_ID
EOF
print_status "Contract IDs saved to contracts/.env.local"

cd ..
print_success "🎉 Local deployment complete!"
