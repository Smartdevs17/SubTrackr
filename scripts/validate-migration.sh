#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=./utils.sh
source "$ROOT_DIR/scripts/utils.sh"
# shellcheck source=../contracts/migrations/lib.sh
source "$ROOT_DIR/contracts/migrations/lib.sh"

NETWORK=""
TARGET_CONTRACT_ID=""
SNAPSHOT_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --target-contract)
            TARGET_CONTRACT_ID="$2"
            shift 2
            ;;
        --snapshot-dir)
            SNAPSHOT_DIR="$2"
            shift 2
            ;;
        *)
            print_error "Unknown argument: $1"
            exit 1
            ;;
    esac
done

if [ -z "$NETWORK" ] || [ -z "$TARGET_CONTRACT_ID" ]; then
    print_error "Usage: ./scripts/validate-migration.sh --network <network> --target-contract <contract-id> [--snapshot-dir <path>]"
    exit 1
fi

migration::require_command soroban
migration::validate_contract_access "$TARGET_CONTRACT_ID" "$NETWORK"

if [ -n "$SNAPSHOT_DIR" ]; then
    if [ ! -f "$SNAPSHOT_DIR/summary.env" ]; then
        print_error "Snapshot summary not found: $SNAPSHOT_DIR/summary.env"
        exit 1
    fi

    # shellcheck source=/dev/null
    source "$SNAPSHOT_DIR/summary.env"
    print_status "Snapshot source contract: $contract_id"
    print_status "Snapshot plan count: $plan_count"
    print_status "Snapshot subscription count: $subscription_count"
fi

print_success "Validation checks completed for contract $TARGET_CONTRACT_ID on $NETWORK"
