#!/bin/bash

# SubTrackr Rollback Scheduling Script
# Schedules a rollback on the proxy using the proxy's rollback delay.
#
# Usage:
#   export SOROBAN_ACCOUNT="your-identity"
#   ./scripts/rollback-schedule.sh <PROXY_ID> <NETWORK>

source "$(dirname "$0")/utils.sh"

set -e

check_command "soroban"
validate_env "SOROBAN_ACCOUNT"

PROXY_ID=$1
NETWORK=$2

if [ -z "$PROXY_ID" ] || [ -z "$NETWORK" ]; then
  print_error "Usage: ./scripts/rollback-schedule.sh <PROXY_ID> <NETWORK>"
  exit 1
fi

print_status "Scheduling rollback on proxy: $PROXY_ID"
EXECUTE_AFTER=$(soroban contract invoke \
  --id "$PROXY_ID" \
  --source "$SOROBAN_ACCOUNT" \
  --network "$NETWORK" \
  -- rollback)

print_success "Rollback scheduled. Execute-after (ledger timestamp): $EXECUTE_AFTER"
print_status "Next: wait until execute-after, then call upgrade_to with the scheduled implementation."
print_status "Hint: soroban contract invoke --id $PROXY_ID --network $NETWORK -- get_scheduled_upgrade"

