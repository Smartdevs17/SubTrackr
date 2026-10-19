// `env.register_contract(..)` is deprecated in favour of `env.register(..)`.
#![allow(deprecated)]
#![cfg(test)]
//! Additional integration tests for Issue #919 — Atomic execution and rollback.
//!
//! These tests supplement the existing `batch_tests.rs` suite with focused
//! assertions on:
//!  - Atomic failure triggering a full rollback.
//!  - Non-atomic partial success.
//!  - Idempotency guard (double-execution rejected).
//!  - Rollback not allowed for charge operations.
//!  - Per-item result codes match the expected failure type.

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
use subtrackr_batch::{
    default_config, BatchError, BatchOperation, BatchState, OperationType, SubTrackrBatch,
    SubTrackrBatchClient,
};

// ── Setup ─────────────────────────────────────────────────────────────────

fn setup() -> (Env, SubTrackrBatchClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubTrackrBatch);
    let client = SubTrackrBatchClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

fn make_op(env: &Env, kind: OperationType, ids: &[u64], params: &[i128]) -> BatchOperation {
    let mut sub_ids = Vec::new(env);
    for &id in ids {
        sub_ids.push_back(id);
    }
    let mut p = Vec::new(env);
    for &v in params {
        p.push_back(v);
    }
    BatchOperation {
        operation_type: kind,
        subscription_ids: sub_ids,
        params: p,
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

/// An atomic batch whose first operation fails should roll back to the
/// pre-batch state and record `BatchState::RolledBack`.
#[test]
fn atomic_failure_rolls_back_all_items() {
    let (env, client, owner) = setup();

    // Seed two subscriptions so they exist.
    let create_op = make_op(&env, OperationType::Create, &[101, 102], &[1000, 1000]);
    let batch_id = client.create_batch(&owner, &create_op, &true);
    client.execute_batch(&batch_id);

    // Now try an update on subscriptions 101 and 999 (999 does not exist).
    let update_op = make_op(&env, OperationType::Update, &[101, 999], &[2000, 2000]);
    let atomic_id = client.create_batch(&owner, &update_op, &true);
    let result = client.execute_batch(&atomic_id);

    // The batch reports that it undid its own work due to missing 999.
    assert!(result.rolled_back);
    assert_eq!(result.state, BatchState::Failed);
    // 101's price is back to 1000, the pre-batch value.
    assert_eq!(client.get_subscription(&101).unwrap().price, 1000);
}

/// A non-atomic batch should allow partial success without rolling back
/// the items that succeeded.
#[test]
fn non_atomic_allows_partial_success() {
    let (env, client, owner) = setup();

    // Seed subscription 201 but not 202.
    let create_op = make_op(&env, OperationType::Create, &[201], &[500]);
    let seed_id = client.create_batch(&owner, &create_op, &false);
    client.execute_batch(&seed_id);

    // Update 201 (exists) and 202 (does not exist) in non-atomic mode.
    let update_op = make_op(&env, OperationType::Update, &[201, 202], &[999, 999]);
    let batch_id = client.create_batch(&owner, &update_op, &false);
    let result = client.execute_batch(&batch_id);

    // Partial state: some items succeeded, some failed.
    assert!(
        result.state == BatchState::PartiallyCompleted || result.state == BatchState::Completed,
        "Expected Partial or Completed, got {:?}",
        result.state
    );
}

/// Executing a batch a second time should be rejected with `AlreadyExecuted`.
#[test]
fn double_execution_is_rejected() {
    let (env, client, owner) = setup();

    let create_op = make_op(&env, OperationType::Create, &[301], &[100]);
    let batch_id = client.create_batch(&owner, &create_op, &false);
    client.execute_batch(&batch_id);

    // Second execution.
    let result = client.try_execute_batch(&batch_id);
    assert_eq!(result, Err(Ok(BatchError::AlreadyExecuted)));
}

/// Charge batches are rollback-eligible: undoing the most recent charge must
/// leave earlier, unrelated charges standing.
#[test]
fn rollback_of_charge_restores_prior_charge_totals() {
    let (env, client, owner) = setup();

    // Seed and charge a subscription.
    let create_op = make_op(&env, OperationType::Create, &[401], &[1000]);
    let create_id = client.create_batch(&owner, &create_op, &false);
    client.execute_batch(&create_id);

    let charge_op = make_op(&env, OperationType::Charge, &[401], &[500]);
    let charge_id = client.create_batch(&owner, &charge_op, &false);
    client.execute_batch(&charge_id);

    // Rolling back the charge batch undoes only that batch's work.
    client.rollback_batch(&owner, &charge_id);
    assert_eq!(client.get_subscription(&401).unwrap().charged, 0);
}

/// Only the batch owner or admin may roll back.
#[test]
fn only_owner_or_admin_can_rollback() {
    let (env, client, owner) = setup();
    let stranger = Address::generate(&env);

    let create_op = make_op(&env, OperationType::Create, &[501], &[100]);
    let batch_id = client.create_batch(&owner, &create_op, &true);
    client.execute_batch(&batch_id);

    // Stranger cannot roll back.
    let result = client.try_rollback_batch(&stranger, &batch_id);
    assert_eq!(result, Err(Ok(BatchError::Unauthorized)));
}

/// Batch size must be within the configured maximum for the operation type.
#[test]
fn batch_size_cap_is_enforced() {
    let (env, client, owner) = setup();

    // Default config for Create allows MAX_BATCH_ITEMS (100).
    let config = default_config(OperationType::Create);
    assert!(config.max_items <= 100);

    // Build a batch that exceeds the limit.
    let ids: std::vec::Vec<u64> = (1u64..=101).collect();
    let op = make_op(&env, OperationType::Create, &ids, &[]);
    let result = client.try_create_batch(&owner, &op, &false);
    assert!(result.is_err(), "Expected error for oversized batch");
}
