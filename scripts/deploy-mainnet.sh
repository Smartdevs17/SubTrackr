#!/bin/bash

# SubTrackr Mainnet Deployment Script
# Deploys smart contracts to the Stellar Public network

# Source utility functions
source "$(dirname "$0")/utils.sh"

set -e

print_warning "⚠️  WARNING: You are about to deploy to the Stellar Public Mainnet!"
print_warning "Ensure that your account has enough XLM for transaction fees and minimum balance."
echo ""

# Validate required environment variables
validate_env "SOROBAN_ACCOUNT"
validate_env "ADMIN_ADDRESS"

read -p "Are you sure you want to proceed? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Deployment cancelled."
    exit 0
fi

# Check prerequisites
check_command "soroban"
check_command "cargo"

UPGRADE_DELAY_SECS="${UPGRADE_DELAY_SECS:-172800}"  # 48h default
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

# Deploy to Mainnet
print_status "Deploying to Mainnet using account: $SOROBAN_ACCOUNT"
STORAGE_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_storage.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network public)

IMPLEMENTATION_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_subscription.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network public)

PROXY_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr_proxy.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network public)

print_success "Storage deployed successfully! ID: $STORAGE_ID"
print_success "Implementation deployed successfully! ID: $IMPLEMENTATION_ID"
print_success "Proxy deployed successfully! ID: $PROXY_ID"

# Initialize contract
print_status "Initializing contract with admin: $ADMIN_ADDRESS"
soroban contract invoke \
    --id "$PROXY_ID" \
    --source "$SOROBAN_ACCOUNT" \
    --network public \
    -- initialize \
    --admin "$ADMIN_ADDRESS" \
    --storage "$STORAGE_ID" \
    --implementation "$IMPLEMENTATION_ID" \
    --upgrade_delay_secs "$UPGRADE_DELAY_SECS" \
    --rollback_delay_secs "$ROLLBACK_DELAY_SECS"

print_success "Contract initialized successfully!"
cat > .env.public <<EOF
PROXY_ID=$PROXY_ID
STORAGE_ID=$STORAGE_ID
IMPLEMENTATION_ID=$IMPLEMENTATION_ID
UPGRADE_DELAY_SECS=$UPGRADE_DELAY_SECS
ROLLBACK_DELAY_SECS=$ROLLBACK_DELAY_SECS
EOF
print_status "Contract IDs saved to contracts/.env.public"

cd ..
print_success "🎉 Mainnet deployment complete!"
