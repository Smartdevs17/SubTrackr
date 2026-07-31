#!/bin/bash

# SubTrackr Testnet Deployment Script
# Deploys smart contracts to the Stellar Testnet

# Source utility functions
source "$(dirname "$0")/utils.sh"

set -e

print_status "🚀 Starting testnet deployment..."

# Check prerequisites
check_command "soroban"
check_command "cargo"

# Validate required environment variables
# SOROBAN_ACCOUNT: The identity name or secret key to use for deployment
# ADMIN_ADDRESS: The address to initialize the contract with as admin
validate_env "SOROBAN_ACCOUNT"
validate_env "ADMIN_ADDRESS"

UPGRADE_DELAY_SECS="${UPGRADE_DELAY_SECS:-86400}"   # 24h default
ROLLBACK_DELAY_SECS="${ROLLBACK_DELAY_SECS:-3600}"  # 1h default

print_status "Build and optimize contracts..."
cd contracts

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

# Deploy to Testnet
print_status "Deploying to Testnet using account: $SOROBAN_ACCOUNT"
STORAGE_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_storage.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network testnet)

IMPLEMENTATION_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_subscription.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network testnet)

PROXY_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_proxy.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network testnet)

print_success "Storage deployed successfully! ID: $STORAGE_ID"
print_success "Implementation deployed successfully! ID: $IMPLEMENTATION_ID"
print_success "Proxy deployed successfully! ID: $PROXY_ID"

# Initialize contract
print_status "Initializing contract with admin: $ADMIN_ADDRESS"
soroban contract invoke \
    --id "$PROXY_ID" \
    --source "$SOROBAN_ACCOUNT" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_ADDRESS" \
    --storage "$STORAGE_ID" \
    --implementation "$IMPLEMENTATION_ID" \
    --upgrade_delay_secs "$UPGRADE_DELAY_SECS" \
    --rollback_delay_secs "$ROLLBACK_DELAY_SECS"

print_success "Contract initialized successfully!"
cat > .env.testnet <<EOF
PROXY_ID=$PROXY_ID
STORAGE_ID=$STORAGE_ID
IMPLEMENTATION_ID=$IMPLEMENTATION_ID
UPGRADE_DELAY_SECS=$UPGRADE_DELAY_SECS
ROLLBACK_DELAY_SECS=$ROLLBACK_DELAY_SECS
EOF
print_status "Contract IDs saved to contracts/.env.testnet"

cd ..
print_success "🎉 Testnet deployment complete!"
