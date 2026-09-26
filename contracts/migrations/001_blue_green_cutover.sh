#!/bin/bash

set -euo pipefail

MIGRATION_ID="001_blue_green_cutover"
MIGRATION_DESCRIPTION="Blue-green Soroban contract redeploy with snapshot export, validation, and reversible cutover."
MIGRATION_STRATEGY="blue-green"

run_migration() {
    local source_contract_id="$1"
    local network="$2"
    local source_account="$3"
    local admin_address="$4"
    local wasm_path="$5"
    local dry_run="$6"

    migration::ensure_workspace

    local timestamp
    timestamp="$(migration::timestamp)"

    local snapshot_dir="$SNAPSHOTS_DIR/${MIGRATION_ID}_${network}_${timestamp}"
    local history_file="$HISTORY_DIR/${MIGRATION_ID}_${network}_${timestamp}.env"
    local previous_contract_id
    previous_contract_id="$(migration::read_active_contract_id "$network")"

    print_status "Exporting snapshot from source contract $source_contract_id"
    if [ "$dry_run" = "true" ]; then
        print_status "Dry run enabled; snapshot export skipped"
    else
        migration::export_snapshot "$source_contract_id" "$network" "$snapshot_dir"
    fi

    local new_contract_id="DRY_RUN_CONTRACT_ID"
    if [ "$dry_run" = "true" ]; then
        print_status "Dry run enabled; deployment and initialization skipped"
    else
        print_status "Deploying replacement contract using strategy: $MIGRATION_STRATEGY"
        new_contract_id="$(migration::deploy_contract "$wasm_path" "$source_account" "$network")"
        migration::initialize_contract "$new_contract_id" "$source_account" "$network" "$admin_address"
        migration::validate_contract_access "$new_contract_id" "$network"
        migration::write_active_contract_id "$network" "$new_contract_id"
    fi

    migration::write_history \
        "$history_file" \
        "MIGRATION_ID=$MIGRATION_ID" \
        "MIGRATION_DESCRIPTION=$MIGRATION_DESCRIPTION" \
        "NETWORK=$network" \
        "STRATEGY=$MIGRATION_STRATEGY" \
        "SOURCE_CONTRACT_ID=$source_contract_id" \
        "PREVIOUS_CONTRACT_ID=$previous_contract_id" \
        "NEW_CONTRACT_ID=$new_contract_id" \
        "SNAPSHOT_DIR=$snapshot_dir" \
        "ADMIN_ADDRESS=$admin_address" \
        "STATUS=completed" \
        "CREATED_AT=$timestamp"

    print_success "Migration history written to $history_file"
    if [ "$dry_run" != "true" ]; then
        print_success "New active contract saved to contracts/.env.$network"
    fi
}
