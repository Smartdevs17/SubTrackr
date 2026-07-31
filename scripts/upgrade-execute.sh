#!/bin/bash

# SubTrackr Upgrade Execution Script
# Executes a previously scheduled upgrade on the proxy.
#
# Usage:
#   export SOROBAN_ACCOUNT="your-identity"
#   ./scripts/upgrade-execute.sh <PROXY_ID> <IMPLEMENTATION_ID> <NETWORK>

source "$(dirname "$0")/utils.sh"

set -e

check_command "soroban"
validate_env "SOROBAN_ACCOUNT"

PROXY_ID=$1
IMPLEMENTATION_ID=$2
NETWORK=$3

if [ -z "$PROXY_ID" ] || [ -z "$IMPLEMENTATION_ID" ] || [ -z "$NETWORK" ]; then
  print_error "Usage: ./scripts/upgrade-execute.sh <PROXY_ID> <IMPLEMENTATION_ID> <NETWORK>"
  exit 1
fi

print_status "Executing upgrade on proxy: $PROXY_ID"
soroban contract invoke \
  --id "$PROXY_ID" \
  --source "$SOROBAN_ACCOUNT" \
  --network "$NETWORK" \
  -- upgrade_to \
  --implementation "$IMPLEMENTATION_ID"

print_success "Upgrade executed."

