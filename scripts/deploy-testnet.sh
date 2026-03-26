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

print_status "Build and optimize contract..."
cd contracts
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm

# Deploy to Testnet
print_status "Deploying to Testnet using account: $SOROBAN_ACCOUNT"
CONTRACT_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr.optimized.wasm \
    --source "$SOROBAN_ACCOUNT" \
    --network testnet)

print_success "Contract deployed successfully! ID: $CONTRACT_ID"

# Initialize contract
print_status "Initializing contract with admin: $ADMIN_ADDRESS"
soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$SOROBAN_ACCOUNT" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_ADDRESS"

print_success "Contract initialized successfully!"
echo "CONTRACT_ID=$CONTRACT_ID" > .env.testnet
print_status "Contract ID saved to contracts/.env.testnet"

cd ..
print_success "🎉 Testnet deployment complete!"
