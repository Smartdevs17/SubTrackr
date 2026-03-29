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

print_status "Build and optimize contract..."
cd contracts
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm

# Deploy to Mainnet
print_status "Deploying to Mainnet using account: $SOROBAN_ACCOUNT"
CONTRACT_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network public)

print_success "Contract deployed successfully! ID: $CONTRACT_ID"

# Initialize contract
print_status "Initializing contract with admin: $ADMIN_ADDRESS"
soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$SOROBAN_ACCOUNT" \
    --network public \
    -- initialize \
    --admin "$ADMIN_ADDRESS"

print_success "Contract initialized successfully!"
echo "CONTRACT_ID=$CONTRACT_ID" > .env.public
print_status "Contract ID saved to contracts/.env.public"

cd ..
print_success "🎉 Mainnet deployment complete!"
