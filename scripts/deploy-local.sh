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
print_status "Building and optimizing contract..."
cd contracts
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm

# Deploy to local network
# Assumes a local network is running and an identity 'alice' exists
print_status "Deploying to local network..."
CONTRACT_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/subtrackr.optimized.wasm \
    --source alice \
    --network local)

print_success "Contract deployed successfully! ID: $CONTRACT_ID"

# Initialize contract
# Use alice as admin for local testing
print_status "Initializing contract..."
soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source alice \
    --network local \
    -- initialize \
    --admin alice

print_success "Contract initialized successfully!"
echo "CONTRACT_ID=$CONTRACT_ID" > .env.local
print_status "Contract ID saved to contracts/.env.local"

cd ..
print_success "🎉 Local deployment complete!"
