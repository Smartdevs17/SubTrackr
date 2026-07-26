#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=./utils.sh
source "$ROOT_DIR/scripts/utils.sh"
# shellcheck source=../contracts/migrations/lib.sh
source "$ROOT_DIR/contracts/migrations/lib.sh"

NETWORK=""
SOURCE_ACCOUNT=""
ADMIN_ADDRESS=""
SOURCE_CONTRACT_ID=""
MIGRATION_NAME="001_blue_green_cutover"
WASM_PATH="$(migration::default_wasm_path)"
SKIP_BUILD="false"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --source)
            SOURCE_ACCOUNT="$2"
            shift 2
            ;;
        --admin)
            ADMIN_ADDRESS="$2"
            shift 2
            ;;
        --from-contract)
            SOURCE_CONTRACT_ID="$2"
            shift 2
            ;;
        --migration)
            MIGRATION_NAME="$2"
            shift 2
            ;;
        --wasm)
            WASM_PATH="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD="true"
            shift
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        *)
            print_error "Unknown argument: $1"
            exit 1
            ;;
    esac
done

if [ -z "$NETWORK" ] || [ -z "$SOURCE_ACCOUNT" ] || [ -z "$ADMIN_ADDRESS" ]; then
    print_error "Usage: ./scripts/run-migration.sh --network <network> --source <soroban-account> --admin <admin-address> [--from-contract <contract-id>] [--migration <name>] [--wasm <path>] [--skip-build] [--dry-run]"
    exit 1
fi

if [ -z "$SOURCE_CONTRACT_ID" ]; then
    SOURCE_CONTRACT_ID="$(migration::read_active_contract_id "$NETWORK")"
fi

if [ -z "$SOURCE_CONTRACT_ID" ]; then
    print_error "No source contract ID supplied and contracts/.env.$NETWORK does not exist."
    exit 1
fi

migration::require_command soroban
migration::require_command cargo

if [ "$SKIP_BUILD" != "true" ] && [ "$DRY_RUN" != "true" ]; then
    print_status "Building optimized contract artifact"
    migration::build_contract
fi

if [ "$DRY_RUN" != "true" ] && [ ! -f "$WASM_PATH" ]; then
    print_error "Optimized WASM not found at $WASM_PATH"
    exit 1
fi

MIGRATION_SCRIPT="$ROOT_DIR/contracts/migrations/$MIGRATION_NAME.sh"
if [ ! -f "$MIGRATION_SCRIPT" ]; then
    print_error "Migration script not found: $MIGRATION_SCRIPT"
    exit 1
fi

# shellcheck source=/dev/null
source "$MIGRATION_SCRIPT"

print_status "Running migration $MIGRATION_ID on network $NETWORK"
run_migration "$SOURCE_CONTRACT_ID" "$NETWORK" "$SOURCE_ACCOUNT" "$ADMIN_ADDRESS" "$WASM_PATH" "$DRY_RUN"
