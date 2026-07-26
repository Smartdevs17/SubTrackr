#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
MIGRATIONS_DIR="$CONTRACTS_DIR/migrations"
HISTORY_DIR="$MIGRATIONS_DIR/history"
SNAPSHOTS_DIR="$MIGRATIONS_DIR/snapshots"

# shellcheck source=../../scripts/utils.sh
source "$ROOT_DIR/scripts/utils.sh"

migration::require_command() {
    check_command "$1"
}

migration::require_env() {
    validate_env "$1"
}

migration::ensure_workspace() {
    mkdir -p "$HISTORY_DIR" "$SNAPSHOTS_DIR"
}

migration::timestamp() {
    date -u +"%Y%m%dT%H%M%SZ"
}

migration::read_active_contract_id() {
    local network="$1"
    local env_file="$CONTRACTS_DIR/.env.$network"

    if [ ! -f "$env_file" ]; then
        return 0
    fi

    grep '^CONTRACT_ID=' "$env_file" | tail -n1 | cut -d'=' -f2-
}

migration::write_active_contract_id() {
    local network="$1"
    local contract_id="$2"
    local env_file="$CONTRACTS_DIR/.env.$network"

    printf 'CONTRACT_ID=%s\n' "$contract_id" > "$env_file"
}

migration::invoke_read() {
    local contract_id="$1"
    local network="$2"
    shift 2

    soroban contract invoke \
        --id "$contract_id" \
        --network "$network" \
        -- "$@"
}

migration::export_snapshot() {
    local contract_id="$1"
    local network="$2"
    local output_dir="$3"

    mkdir -p "$output_dir/plans" "$output_dir/subscriptions"

    local plan_count
    local subscription_count

    plan_count="$(migration::invoke_read "$contract_id" "$network" get_plan_count)"
    subscription_count="$(migration::invoke_read "$contract_id" "$network" get_subscription_count)"

    printf 'contract_id=%s\nnetwork=%s\nplan_count=%s\nsubscription_count=%s\n' \
        "$contract_id" "$network" "$plan_count" "$subscription_count" > "$output_dir/summary.env"

    local i
    for ((i = 1; i <= plan_count; i++)); do
        migration::invoke_read "$contract_id" "$network" get_plan --plan_id "$i" > "$output_dir/plans/$i.json"
    done

    for ((i = 1; i <= subscription_count; i++)); do
        migration::invoke_read "$contract_id" "$network" get_subscription --subscription_id "$i" > "$output_dir/subscriptions/$i.json"
    done
}

migration::build_contract() {
    (
        cd "$CONTRACTS_DIR"
        cargo build --target wasm32-unknown-unknown --release
        soroban contract optimize --wasm target/wasm32-unknown-unknown/release/subtrackr.wasm
    )
}

migration::default_wasm_path() {
    printf '%s\n' "$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/subtrackr.optimized.wasm"
}

migration::deploy_contract() {
    local wasm_path="$1"
    local source_account="$2"
    local network="$3"

    soroban contract deploy \
        --wasm "$wasm_path" \
        --source "$source_account" \
        --network "$network"
}

migration::initialize_contract() {
    local contract_id="$1"
    local source_account="$2"
    local network="$3"
    local admin_address="$4"

    soroban contract invoke \
        --id "$contract_id" \
        --source "$source_account" \
        --network "$network" \
        -- initialize \
        --admin "$admin_address"
}

migration::validate_contract_access() {
    local contract_id="$1"
    local network="$2"

    migration::invoke_read "$contract_id" "$network" get_plan_count > /dev/null
    migration::invoke_read "$contract_id" "$network" get_subscription_count > /dev/null
}

migration::write_history() {
    local output_file="$1"
    shift
    printf '%s\n' "$@" > "$output_file"
}
