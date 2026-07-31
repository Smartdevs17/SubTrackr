#!/bin/bash

# SubTrackr Contract Verification Script
# Verifies a deployed contract by running simple queries

# Source utility functions
source "$(dirname "$0")/utils.sh"

set -e

# Usage: ./verify.sh <PROXY_ID> <NETWORK> [SOURCE]
if [ -z "$1" ] || [ -z "$2" ]; then
    print_error "Usage: ./scripts/verify.sh <PROXY_ID> <NETWORK> [SOURCE]"
    exit 1
fi

PROXY_ID=$1
NETWORK=$2
SOURCE=${3:-alice}

print_status "🔍 Verifying proxy: $PROXY_ID on network: $NETWORK"

# Check if contract is alive by querying the plan count
print_status "Querying plan count..."
PLAN_COUNT=$(soroban contract invoke \
    --id "$PROXY_ID" \
    --network "$NETWORK" \
    --source "$SOURCE" \
    -- get_plan_count)

if [ $? -eq 0 ]; then
    print_success "Contract verification successful! Plan count: $PLAN_COUNT"
else
    print_error "Contract verification failed. Could not query plan count."
    exit 1
fi
