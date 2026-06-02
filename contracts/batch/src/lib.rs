#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};

mod batch;
use batch::{BatchFilter, BatchOperation, BatchResult, BatchState, BatchStatus, CancelReason, OperationResult, OperationType, SubRecord, SubscriptionId};
use subtrackr_types::SubscriptionId as SubscriptionIdAlias;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum BatchError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidBatch = 3,
    AlreadyExecuted = 4,
    NotFound = 5,
    Unauthorized = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct BatchItem {
    pub account: Address,
    pub amount: i128,
    pub is_refund: bool,
}

#[contract]
pub struct SubTrackrBatch;

#[contractimpl]
impl SubTrackrBatch {
    pub fn initialize(env: Env, admin: Address) -> Result<(), BatchError> {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            return Err(BatchError::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::NextBatchId, &1u64);
        storage.set(&DataKey::BatchHistory, &Vec::new(&env));
        Ok(())
    }

    pub fn create_batch_operation(
        env: Env,
        _owner: Address,
        operation: BatchOperation,
        atomic: bool,
    ) -> Result<u64, BatchError> {
        let storage = env.storage().instance();
        if !storage.has(&DataKey::Admin) {
            return Err(BatchError::NotInitialized);
        }
        if !batch::validate_batch_operation(&operation) {
            return Err(BatchError::InvalidBatch);
        }

        let batch_id = Self::next_batch_id(&env);
        storage.set(&DataKey::BatchOperation(batch_id), &operation);
        storage.set(&DataKey::BatchState(batch_id), &BatchState::Pending);

        let mut history: Vec<u64> = storage.get(&DataKey::BatchHistory).unwrap_or_else(|| Vec::new(&env));
        history.push_back(batch_id);
        storage.set(&DataKey::BatchHistory, &history);

        storage.set(&DataKey::NextBatchId, &(batch_id + 1));

        let mut result = BatchResult {
            batch_id,
            total_operations: operation.subscription_ids.len() as u32,
            successful_operations: 0,
            failed_operations: 0,
            skipped_operations: 0,
            results: Vec::new(&env),
            atomic,
            rolled_back: false,
            gas_estimate: batch::estimate_batch_gas(&operation),
        };
        storage.set(&DataKey::BatchResult(batch_id), &result);
        Ok(batch_id)
    }

    pub fn execute_batch(env: Env, batch_id: u64) -> Result<BatchResult, BatchError> {
        let storage = env.storage().instance();
        if !storage.has(&DataKey::Admin) {
            return Err(BatchError::NotInitialized);
        }

        let state: BatchState = storage
            .get(&DataKey::BatchState(batch_id))
            .ok_or(BatchError::NotFound)?;
        if state != BatchState::Pending {
            return Err(BatchError::AlreadyExecuted);
        }

        let operation: BatchOperation = storage
            .get(&DataKey::BatchOperation(batch_id))
            .ok_or(BatchError::NotFound)?;
        let mut result: BatchResult = storage
            .get(&DataKey::BatchResult(batch_id))
            .ok_or(BatchError::NotFound)?;

        let mut modified: Vec<(SubscriptionIdAlias, Option<SubRecord>)> = Vec::new(&env);
        let mut failed_count = 0u32;
        let mut successful_count = 0u32;
        let mut skipped_count = 0u32;
        let mut saw_failure = false;

        for idx in 0..operation.subscription_ids.len() {
            let subscription_id = operation.subscription_ids.get(idx).unwrap();
            let prior = storage.get(&DataKey::Subscription(subscription_id)).ok();
            modified.push_back((*subscription_id, prior.clone()));

            let op_result = match operation.operation_type {
                OperationType::Create => Self::execute_create(&env, *subscription_id, prior.clone()),
                OperationType::Charge => Self::execute_charge(
                    &env,
                    *subscription_id,
                    operation.params.get(idx).unwrap_or(0),
                    prior.clone(),
                ),
                OperationType::Update => Self::execute_update(
                    &env,
                    *subscription_id,
                    operation.params.get(idx).unwrap_or(0),
                    prior.clone(),
                ),
                OperationType::Cancel => Self::execute_cancel(
                    &env,
                    *subscription_id,
                    operation.cancel_reasons.get(idx).unwrap_or(batch::CancelReason::Custom).clone(),
                    prior.clone(),
                ),
                _ => OperationResult {
                    subscription_id: *subscription_id,
                    success: true,
                    code: 0,
                    reason: None,
                },
            };

            result.results.push_back(op_result.clone());
            if op_result.success {
                successful_count += 1;
            } else {
                failed_count += 1;
                saw_failure = true;
            }

            if saw_failure && result.atomic {
                skipped_count += (operation.subscription_ids.len() - idx - 1) as u32;
                break;
            }
        }

        if result.atomic && saw_failure {
            for entry in modified.iter() {
                let (sub_id, original) = entry;
                if let Some(record) = original {
                    storage.set(&DataKey::Subscription(*sub_id), record);
                } else {
                    env.storage().instance().remove(&DataKey::Subscription(*sub_id));
                }
            }
            successful_count = 0;
            skipped_count = result.total_operations - failed_count;
            result.rolled_back = true;
            result.state = BatchState::Failed;
        } else if failed_count == 0 {
            result.state = BatchState::Completed;
        } else {
            result.state = BatchState::PartiallyCompleted;
        }

        result.successful_operations = successful_count;
        result.failed_operations = failed_count;
        result.skipped_operations = skipped_count;
        storage.set(&DataKey::BatchResult(batch_id), &result);
        storage.set(&DataKey::BatchState(batch_id), &result.state);

        Ok(result)
    }

    pub fn get_batch_status(env: Env, batch_id: u64) -> Result<BatchStatus, BatchError> {
        let storage = env.storage().instance();
        let state: BatchState = storage
            .get(&DataKey::BatchState(batch_id))
            .ok_or(BatchError::NotFound)?;
        let result: BatchResult = storage
            .get(&DataKey::BatchResult(batch_id))
            .ok_or(BatchError::NotFound)?;

        Ok(BatchStatus {
            batch_id,
            state,
            total: result.total_operations,
            succeeded: result.successful_operations,
            failed: result.failed_operations,
        })
    }

    pub fn get_subscription(env: Env, subscription_id: SubscriptionIdAlias) -> Option<SubRecord> {
        env.storage().instance().get(&DataKey::Subscription(subscription_id))
    }

    pub fn get_batch_history(env: Env) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::BatchHistory)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn seed_subscription(env: Env, subscription_id: SubscriptionIdAlias) {
        let record = SubRecord {
            exists: true,
            status: batch::SubStatus::Active,
            charged: 0,
        };
        env.storage().instance().set(&DataKey::Subscription(subscription_id), &record);
    }
}

impl SubTrackrBatch {
    fn next_batch_id(env: &Env) -> u64 {
        let storage = env.storage().instance();
        storage.get(&DataKey::NextBatchId).unwrap_or(1u64)
    }

    fn execute_create(
        env: &Env,
        subscription_id: SubscriptionIdAlias,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        if prior.is_some() {
            OperationResult {
                subscription_id,
                success: false,
                code: 1,
                reason: Some(String::from_small_str("AlreadyExists")),
            }
        } else {
            let record = SubRecord {
                exists: true,
                status: batch::SubStatus::Active,
                charged: 0,
            };
            env.storage().instance().set(&DataKey::Subscription(subscription_id), &record);
            OperationResult {
                subscription_id,
                success: true,
                code: 0,
                reason: None,
            }
        }
    }

    fn execute_charge(
        env: &Env,
        subscription_id: SubscriptionIdAlias,
        amount: i128,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        match prior {
            Some(mut record) if record.exists && record.status != batch::SubStatus::Cancelled => {
                record.charged += amount;
                env.storage().instance().set(&DataKey::Subscription(subscription_id), &record);
                OperationResult {
                    subscription_id,
                    success: true,
                    code: 0,
                    reason: None,
                }
            }
            Some(_) => OperationResult {
                subscription_id,
                success: false,
                code: 2,
                reason: Some(String::from_small_str("InvalidSubscription")),
            },
            None => OperationResult {
                subscription_id,
                success: false,
                code: 3,
                reason: Some(String::from_small_str("SubscriptionMissing")),
            },
        }
    }

    fn execute_update(
        _env: &Env,
        subscription_id: SubscriptionIdAlias,
        _param: i128,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        if prior.is_some() {
            OperationResult {
                subscription_id,
                success: true,
                code: 0,
                reason: None,
            }
        } else {
            OperationResult {
                subscription_id,
                success: false,
                code: 4,
                reason: Some(String::from_small_str("SubscriptionMissing")),
            }
        }
    }

    fn execute_cancel(
        env: &Env,
        subscription_id: SubscriptionIdAlias,
        _reason: CancelReason,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        match prior {
            Some(mut record) if record.exists => {
                record.status = batch::SubStatus::Cancelled;
                env.storage().instance().set(&DataKey::Subscription(subscription_id), &record);
                OperationResult {
                    subscription_id,
                    success: true,
                    code: 0,
                    reason: None,
                }
            }
            _ => OperationResult {
                subscription_id,
                success: false,
                code: 5,
                reason: Some(String::from_small_str("SubscriptionMissing")),
            },
        }
    }
}
