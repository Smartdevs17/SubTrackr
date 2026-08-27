#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=./utils.sh
source "$ROOT_DIR/scripts/utils.sh"
# shellcheck source=../contracts/migrations/lib.sh
source "$ROOT_DIR/contracts/migrations/lib.sh"

HISTORY_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --history-file)
            HISTORY_FILE="$2"
            shift 2
            ;;
        *)
            print_error "Unknown argument: $1"
            exit 1
            ;;
    esac
done

if [ -z "$HISTORY_FILE" ]; then
    print_error "Usage: ./scripts/rollback-migration.sh --history-file <contracts/migrations/history/*.env>"
    exit 1
fi

if [ ! -f "$HISTORY_FILE" ]; then
    print_error "History file not found: $HISTORY_FILE"
    exit 1
fi

# shellcheck source=/dev/null
source "$HISTORY_FILE"

if [ -z "${NETWORK:-}" ] || [ -z "${PREVIOUS_CONTRACT_ID:-}" ]; then
    print_error "History file is missing NETWORK or PREVIOUS_CONTRACT_ID"
    exit 1
fi

migration::write_active_contract_id "$NETWORK" "$PREVIOUS_CONTRACT_ID"
print_success "Restored contracts/.env.$NETWORK to contract $PREVIOUS_CONTRACT_ID"
