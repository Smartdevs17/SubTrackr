#![cfg(test)]
//! Integration tests for the batch operations contract.

use soroban_sdk::{testutils::Address as _, vec, Address, Env, Vec};
use subtrackr_batch::{
    estimate_batch_gas, validate_batch_operation, BatchError, BatchOperation, BatchState,
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
