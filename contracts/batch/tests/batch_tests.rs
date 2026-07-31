#![cfg(test)]
//! Integration tests for the batch operations contract.

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, vec, Address, Env, Vec};
use subtrackr_batch::{
    cancel_reason_code, cancel_reason_from_code, default_config, estimate_batch_gas,
    validate_batch_operation, BatchConfig, BatchError, BatchOperation, BatchState, CancelReason,
    OperationType, SubTrackrBatch, SubTrackrBatchClient,
};

fn setup() -> (Env, SubTrackrBatchClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubTrackrBatch);
    let client = SubTrackrBatchClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

fn op(env: &Env, kind: OperationType, ids: &[u64], params: &[i128]) -> BatchOperation {
    let mut sub_ids = Vec::new(env);
    for id in ids {
        sub_ids.push_back(*id);
    }
    let mut p = Vec::new(env);
    for v in params {
        p.push_back(*v);
    }
    BatchOperation {
        operation_type: kind,
        subscription_ids: sub_ids,
        params: p,
    }
}

#[test]
fn validates_batch_size() {
    let env = Env::default();
    // Empty batch is invalid.
    let empty = op(&env, OperationType::Create, &[], &[]);
    assert!(!validate_batch_operation(&empty));

    // One operation is valid.
    let one = op(&env, OperationType::Create, &[1], &[]);
    assert!(validate_batch_operation(&one));

    // 101 operations exceed the max of 100.
    let ids: Vec<u64> = {
        let mut v = Vec::new(&env);
        for i in 0..101u64 {
            v.push_back(i);
        }
        v
    };
    let too_big = BatchOperation {
        operation_type: OperationType::Create,
        subscription_ids: ids,
        params: Vec::new(&env),
    };
    assert!(!validate_batch_operation(&too_big));
}

#[test]
fn estimates_gas() {
    let env = Env::default();
    let five = op(&env, OperationType::Create, &[0, 1, 2, 3, 4], &[]);
    // 50,000 base + 5 * 100,000.
    assert_eq!(estimate_batch_gas(&five), 550_000);
}

#[test]
fn creates_and_executes_batch_successfully() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    let create = op(&env, OperationType::Create, &[1, 2, 3], &[]);
    let id = client.create_batch_operation(&owner, &create, &false);

    let result = client.execute_batch(&id);
    assert_eq!(result.total_operations, 3);
    assert_eq!(result.successful_operations, 3);
    assert_eq!(result.failed_operations, 0);
    assert_eq!(result.gas_estimate, 350_000);
    assert!(!result.rolled_back);

    let status = client.get_batch_status(&id);
    assert_eq!(status.state, BatchState::Completed);
    assert!(client.get_subscription(&1).is_some());
}

#[test]
fn non_atomic_batch_allows_partial_success() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    // Only subscription 1 exists; charging 1, 2, 3 should partially succeed.
    client.seed_subscription(&1);
    let charge = op(&env, OperationType::Charge, &[1, 2, 3], &[100, 100, 100]);
    let id = client.create_batch_operation(&owner, &charge, &false);

    let result = client.execute_batch(&id);
    assert_eq!(result.successful_operations, 1);
    assert_eq!(result.failed_operations, 2);
    assert!(!result.rolled_back);

    let status = client.get_batch_status(&id);
    assert_eq!(status.state, BatchState::PartiallyCompleted);
    // The one chargeable subscription was actually charged.
    assert_eq!(client.get_subscription(&1).unwrap().charged, 100);
}

#[test]
fn atomic_batch_rolls_back_on_any_failure() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    client.seed_subscription(&1);
    let charge = op(&env, OperationType::Charge, &[1, 2], &[100, 100]);
    let id = client.create_batch_operation(&owner, &charge, &true); // atomic

    let result = client.execute_batch(&id);
    assert!(result.rolled_back);
    assert_eq!(result.successful_operations, 0);
    assert_eq!(result.failed_operations, 1);

    let status = client.get_batch_status(&id);
    assert_eq!(status.state, BatchState::Failed);
    // Rollback: subscription 1 was NOT charged despite being chargeable.
    assert_eq!(client.get_subscription(&1).unwrap().charged, 0);
}

#[test]
fn rejects_double_execution() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let create = op(&env, OperationType::Create, &[1], &[]);
    let id = client.create_batch_operation(&owner, &create, &false);
    client.execute_batch(&id);
    let res = client.try_execute_batch(&id);
    assert_eq!(res, Err(Ok(BatchError::AlreadyExecuted)));
}

#[test]
fn rejects_invalid_batch_creation() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let empty = op(&env, OperationType::Create, &[], &[]);
    let res = client.try_create_batch_operation(&owner, &empty, &false);
    assert_eq!(res, Err(Ok(BatchError::InvalidBatch)));
}

#[test]
fn records_audit_history() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let a =
        client.create_batch_operation(&owner, &op(&env, OperationType::Create, &[1], &[]), &false);
    let b =
        client.create_batch_operation(&owner, &op(&env, OperationType::Create, &[2], &[]), &false);
    let history = client.get_batch_history();
    assert_eq!(history, vec![&env, a, b]);
}

// ── Status tracking ──────────────────────────────────────────────────────

#[test]
fn tracks_pending_state_before_execution() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[1, 2], &[]),
        &false,
    );

    let status = client.get_batch_status(&id);
    assert_eq!(status.state, BatchState::Pending);
    assert_eq!(status.total, 2);
    assert_eq!(status.succeeded, 0);
    assert_eq!(status.started_at, 0);
    assert_eq!(status.completed_at, 0);
}

#[test]
fn records_execution_timing() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[1, 2], &[]),
        &false,
    );
    let result = client.execute_batch(&id);

    let status = client.get_batch_status(&id);
    assert_eq!(status.started_at, 1_000);
    assert_eq!(status.completed_at, 1_000);
    assert_eq!(status.duration, 0);
    assert_eq!(result.duration, 0);
    assert_eq!(status.succeeded, 2);
}

#[test]
fn exposes_per_item_results() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Charge, &[1, 2], &[100, 100]),
        &false,
    );
    let result = client.execute_batch(&id);

    assert_eq!(result.results.len(), 2);
    assert!(result.results.get(0).unwrap().success);
    assert_eq!(result.results.get(0).unwrap().code, 0);
    assert!(!result.results.get(1).unwrap().success);
    // 302 == CoreError::SubscriptionNotFound
    assert_eq!(result.results.get(1).unwrap().code, 302);

    let stored = client.get_batch_result(&id).unwrap();
    assert_eq!(stored, result);
}

// ── Update and cancel operations ─────────────────────────────────────────

#[test]
fn batch_update_rewrites_prices() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);
    client.seed_subscription(&2);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Update, &[1, 2], &[500, 900]),
        &false,
    );
    let result = client.execute_batch(&id);

    assert_eq!(result.successful_operations, 2);
    assert_eq!(client.get_subscription(&1).unwrap().price, 500);
    assert_eq!(client.get_subscription(&2).unwrap().price, 900);
}

#[test]
fn batch_cancel_deactivates_subscriptions() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    let reason = cancel_reason_code(&CancelReason::TooExpensive);
    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Cancel, &[1], &[reason]),
        &false,
    );
    let result = client.execute_batch(&id);

    assert_eq!(result.successful_operations, 1);
    assert!(!client.get_subscription(&1).unwrap().active);
}

#[test]
fn batch_cancel_rejects_already_cancelled() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    let first =
        client.create_batch_operation(&owner, &op(&env, OperationType::Cancel, &[1], &[]), &false);
    client.execute_batch(&first);

    let second =
        client.create_batch_operation(&owner, &op(&env, OperationType::Cancel, &[1], &[]), &false);
    let result = client.execute_batch(&second);
    assert_eq!(result.failed_operations, 1);
    // 501 == CoreError::SubscriptionAlreadyCancelled
    assert_eq!(result.results.get(0).unwrap().code, 501);
}

#[test]
fn cancel_reason_codes_round_trip() {
    for reason in [
        CancelReason::TooExpensive,
        CancelReason::NoLongerNeeded,
        CancelReason::FoundAlternative,
        CancelReason::PoorService,
        CancelReason::Other,
    ] {
        let code = cancel_reason_code(&reason);
        assert_eq!(cancel_reason_from_code(code), reason);
    }
    // Unknown codes degrade to `Other` rather than panicking.
    assert_eq!(cancel_reason_from_code(99), CancelReason::Other);
}

#[test]
fn update_requires_one_param_per_subscription() {
    let env = Env::default();
    let short = op(&env, OperationType::Update, &[1, 2], &[100]);
    assert!(!validate_batch_operation(&short));

    let matched = op(&env, OperationType::Update, &[1, 2], &[100, 200]);
    assert!(validate_batch_operation(&matched));

    // Cancel reasons are optional.
    let no_reasons = op(&env, OperationType::Cancel, &[1, 2], &[]);
    assert!(validate_batch_operation(&no_reasons));
}

// ── Per-operation configuration ──────────────────────────────────────────

#[test]
fn exposes_default_config_per_operation_type() {
    let (_env, client, _admin) = setup();

    let create = client.get_batch_config(&OperationType::Create);
    assert_eq!(create.max_items, 100);
    assert!(!create.atomic_default);
    assert!(create.allow_rollback);

    // Money movement is atomic by default; cancellation is not reversible.
    assert!(
        client
            .get_batch_config(&OperationType::Charge)
            .atomic_default
    );
    assert!(
        !client
            .get_batch_config(&OperationType::Cancel)
            .allow_rollback
    );
}

#[test]
fn admin_can_tighten_batch_size_per_operation_type() {
    let (env, client, admin) = setup();
    let owner = Address::generate(&env);

    client.set_batch_config(
        &admin,
        &OperationType::Create,
        &BatchConfig {
            max_items: 2,
            atomic_default: true,
            allow_rollback: false,
            gas_per_item: 100_000,
        },
    );

    let within = op(&env, OperationType::Create, &[1, 2], &[]);
    assert!(client
        .try_create_batch_operation(&owner, &within, &false)
        .is_ok());

    let over = op(&env, OperationType::Create, &[3, 4, 5], &[]);
    assert_eq!(
        client.try_create_batch_operation(&owner, &over, &false),
        Err(Ok(BatchError::InvalidBatch))
    );
}

#[test]
fn non_admin_cannot_change_config() {
    let (env, client, _admin) = setup();
    let intruder = Address::generate(&env);
    let res = client.try_set_batch_config(
        &intruder,
        &OperationType::Create,
        &default_config(&OperationType::Create),
    );
    assert_eq!(res, Err(Ok(BatchError::Unauthorized)));
}

#[test]
fn rejects_config_above_hard_ceiling() {
    let (_env, client, admin) = setup();
    let res = client.try_set_batch_config(
        &admin,
        &OperationType::Create,
        &BatchConfig {
            max_items: 101,
            atomic_default: false,
            allow_rollback: true,
            gas_per_item: 100_000,
        },
    );
    assert_eq!(res, Err(Ok(BatchError::InvalidBatch)));
}

#[test]
fn default_atomicity_comes_from_config() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    // Charge defaults to atomic, so the missing subscription 2 discards the
    // charge against subscription 1 as well.
    let id = client.create_batch_operation_default(
        &owner,
        &op(&env, OperationType::Charge, &[1, 2], &[100, 100]),
    );
    let result = client.execute_batch(&id);
    assert!(result.rolled_back);
    assert_eq!(client.get_subscription(&1).unwrap().charged, 0);
}

#[test]
fn gas_estimate_follows_configured_rate() {
    let (env, client, admin) = setup();
    let owner = Address::generate(&env);

    client.set_batch_config(
        &admin,
        &OperationType::Create,
        &BatchConfig {
            max_items: 100,
            atomic_default: false,
            allow_rollback: true,
            gas_per_item: 10_000,
        },
    );

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[1, 2], &[]),
        &false,
    );
    let result = client.execute_batch(&id);
    assert_eq!(result.gas_estimate, 50_000 + 2 * 10_000);
}

// ── Rollback ─────────────────────────────────────────────────────────────

#[test]
fn rollback_removes_subscriptions_created_by_the_batch() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[7, 8], &[]),
        &false,
    );
    client.execute_batch(&id);
    assert!(client.get_subscription(&7).is_some());

    let status = client.rollback_batch(&owner, &id);
    assert_eq!(status.state, BatchState::RolledBack);
    assert!(client.get_subscription(&7).is_none());
    assert!(client.get_subscription(&8).is_none());
}

#[test]
fn rollback_restores_prior_charge_totals() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    let seed = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Charge, &[1], &[100]),
        &false,
    );
    client.execute_batch(&seed);
    assert_eq!(client.get_subscription(&1).unwrap().charged, 100);

    let second = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Charge, &[1], &[250]),
        &false,
    );
    client.execute_batch(&second);
    assert_eq!(client.get_subscription(&1).unwrap().charged, 350);

    client.rollback_batch(&owner, &second);
    // Only the second batch is undone; the first charge stands.
    assert_eq!(client.get_subscription(&1).unwrap().charged, 100);
}

#[test]
fn rollback_of_repeated_subscription_restores_pre_batch_state() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    // Subscription 1 is charged twice within one batch.
    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Charge, &[1, 1], &[100, 200]),
        &false,
    );
    client.execute_batch(&id);
    assert_eq!(client.get_subscription(&1).unwrap().charged, 300);

    client.rollback_batch(&owner, &id);
    assert_eq!(client.get_subscription(&1).unwrap().charged, 0);
}

#[test]
fn rollback_is_rejected_for_operation_types_that_disallow_it() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    let id =
        client.create_batch_operation(&owner, &op(&env, OperationType::Cancel, &[1], &[]), &false);
    client.execute_batch(&id);

    assert_eq!(
        client.try_rollback_batch(&owner, &id),
        Err(Ok(BatchError::RollbackNotAllowed))
    );
}

#[test]
fn rollback_is_rejected_before_execution() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let id =
        client.create_batch_operation(&owner, &op(&env, OperationType::Create, &[1], &[]), &false);
    assert_eq!(
        client.try_rollback_batch(&owner, &id),
        Err(Ok(BatchError::NotExecuted))
    );
}

#[test]
fn rollback_cannot_be_applied_twice() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let id =
        client.create_batch_operation(&owner, &op(&env, OperationType::Create, &[1], &[]), &false);
    client.execute_batch(&id);
    client.rollback_batch(&owner, &id);
    assert_eq!(
        client.try_rollback_batch(&owner, &id),
        Err(Ok(BatchError::AlreadyRolledBack))
    );
}

#[test]
fn only_owner_or_admin_may_roll_back() {
    let (env, client, admin) = setup();
    let owner = Address::generate(&env);
    let intruder = Address::generate(&env);

    let id =
        client.create_batch_operation(&owner, &op(&env, OperationType::Create, &[1], &[]), &false);
    client.execute_batch(&id);

    assert_eq!(
        client.try_rollback_batch(&intruder, &id),
        Err(Ok(BatchError::Unauthorized))
    );
    // The admin can still intervene.
    assert!(client.try_rollback_batch(&admin, &id).is_ok());
}

#[test]
fn atomic_failure_leaves_nothing_to_roll_back() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Charge, &[1, 2], &[100, 100]),
        &true,
    );
    let result = client.execute_batch(&id);
    assert!(result.rolled_back);

    assert_eq!(
        client.try_rollback_batch(&owner, &id),
        Err(Ok(BatchError::RollbackNotAllowed))
    );
}

// ── Analytics ────────────────────────────────────────────────────────────

#[test]
fn analytics_start_empty() {
    let (_env, client, _admin) = setup();
    let analytics = client.get_batch_analytics();
    assert_eq!(analytics.total_batches, 0);
    assert_eq!(analytics.success_rate_bps, 0);
    assert_eq!(analytics.avg_duration, 0);
}

#[test]
fn analytics_track_success_rate_and_timing() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    client.seed_subscription(&1);

    env.ledger().with_mut(|l| l.timestamp = 100);
    let first = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[5, 6], &[]),
        &false,
    );
    client.execute_batch(&first);

    // 1 of 3 charges succeeds, so 3 of 5 items overall.
    let second = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Charge, &[1, 2, 3], &[10, 10, 10]),
        &false,
    );
    client.execute_batch(&second);

    let analytics = client.get_batch_analytics();
    assert_eq!(analytics.total_batches, 2);
    assert_eq!(analytics.completed_batches, 1);
    assert_eq!(analytics.partial_batches, 1);
    assert_eq!(analytics.total_items, 5);
    assert_eq!(analytics.successful_items, 3);
    assert_eq!(analytics.failed_items, 2);
    assert_eq!(analytics.success_rate_bps, 6_000);
    assert_eq!(analytics.avg_duration, 0);
}

#[test]
fn analytics_are_partitioned_by_operation_type() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[1, 2], &[]),
        &false,
    );
    client.execute_batch(&id);

    let creates = client.get_batch_analytics_for(&OperationType::Create);
    assert_eq!(creates.total_batches, 1);
    assert_eq!(creates.successful_items, 2);
    assert_eq!(creates.success_rate_bps, 10_000);

    let charges = client.get_batch_analytics_for(&OperationType::Charge);
    assert_eq!(charges.total_batches, 0);
}

#[test]
fn rollback_discounts_successful_items_from_analytics() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    let id = client.create_batch_operation(
        &owner,
        &op(&env, OperationType::Create, &[1, 2], &[]),
        &false,
    );
    client.execute_batch(&id);
    assert_eq!(client.get_batch_analytics().success_rate_bps, 10_000);

    client.rollback_batch(&owner, &id);

    let analytics = client.get_batch_analytics();
    assert_eq!(analytics.rolled_back_batches, 1);
    assert_eq!(analytics.successful_items, 0);
    assert_eq!(analytics.success_rate_bps, 0);
}
