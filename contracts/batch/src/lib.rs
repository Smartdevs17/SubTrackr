#![no_std]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

const MAX_BATCH_ITEMS: u32 = 100;
const GAS_BASE: u64 = 50_000;
const GAS_PER_ITEM: u64 = 100_000;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum BatchError {
    InvalidBatch = 1,
    AlreadyExecuted = 2,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationType {
    Create,
    Charge,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchOperation {
    pub operation_type: OperationType,
    pub subscription_ids: Vec<u64>,
    pub params: Vec<i128>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchState {
    Pending,
    Completed,
    PartiallyCompleted,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchStatus {
    pub state: BatchState,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionRecord {
    pub id: u64,
    pub charged: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchResult {
    pub total_operations: u32,
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub gas_estimate: u64,
    pub rolled_back: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    BatchCount,
    Batch(u64),
    BatchOwner(u64),
    BatchAtomic(u64),
    BatchExecuted(u64),
    BatchStatus(u64),
    Subscription(u64),
    History,
}

pub fn validate_batch_operation(op: &BatchOperation) -> bool {
    let n = op.subscription_ids.len();
    if n == 0 || n > MAX_BATCH_ITEMS {
        return false;
    }
    match op.operation_type {
        OperationType::Create => true,
        OperationType::Charge => op.params.len() == n,
    }
}

pub fn estimate_batch_gas(op: &BatchOperation) -> u64 {
    GAS_BASE + (op.subscription_ids.len() as u64 * GAS_PER_ITEM)
}

#[contract]
pub struct SubTrackrBatch;

#[contractimpl]
impl SubTrackrBatch {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            return;
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::BatchCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::History, &Vec::<u64>::new(&env));
    }

    pub fn seed_subscription(env: Env, subscription_id: u64) {
        let sub = SubscriptionRecord {
            id: subscription_id,
            charged: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &sub);
    }

    pub fn get_subscription(env: Env, subscription_id: u64) -> Option<SubscriptionRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
    }

    pub fn create_batch_operation(
        env: Env,
        owner: Address,
        operation: BatchOperation,
        atomic: bool,
    ) -> Result<u64, BatchError> {
        owner.require_auth();
        if !validate_batch_operation(&operation) {
            return Err(BatchError::InvalidBatch);
        }

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCount)
            .unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::BatchCount, &count);

        env.storage()
            .persistent()
            .set(&DataKey::Batch(count), &operation);
        env.storage()
            .persistent()
            .set(&DataKey::BatchOwner(count), &owner);
        env.storage()
            .persistent()
            .set(&DataKey::BatchAtomic(count), &atomic);
        env.storage()
            .persistent()
            .set(&DataKey::BatchExecuted(count), &false);
        env.storage().persistent().set(
            &DataKey::BatchStatus(count),
            &BatchStatus {
                state: BatchState::Pending,
            },
        );

        let mut history: Vec<u64> = env.storage().instance().get(&DataKey::History).unwrap();
        history.push_back(count);
        env.storage().instance().set(&DataKey::History, &history);

        Ok(count)
    }

    pub fn get_batch_history(env: Env) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::History)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_batch_status(env: Env, batch_id: u64) -> BatchStatus {
        env.storage()
            .persistent()
            .get(&DataKey::BatchStatus(batch_id))
            .unwrap_or(BatchStatus {
                state: BatchState::Pending,
            })
    }

    pub fn execute_batch(env: Env, batch_id: u64) -> Result<BatchResult, BatchError> {
        let executed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BatchExecuted(batch_id))
            .unwrap_or(false);
        if executed {
            return Err(BatchError::AlreadyExecuted);
        }

        let op: BatchOperation = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .ok_or(BatchError::InvalidBatch)?;
        let atomic: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BatchAtomic(batch_id))
            .unwrap_or(false);

        let total = op.subscription_ids.len();
        let gas_estimate = estimate_batch_gas(&op);

        let mut successful: u32 = 0;
        let mut failed: u32 = 0;

        // Minimal rollback model used by tests: if atomic and any failure occurs,
        // we do not persist any successful effects.
        let mut staged: Vec<SubscriptionRecord> = Vec::new(&env);

        for (i, sub_id) in op.subscription_ids.iter().enumerate() {
            let idx: u32 = i as u32;
            match op.operation_type {
                OperationType::Create => {
                    let sub = SubscriptionRecord {
                        id: sub_id,
                        charged: 0,
                    };
                    if atomic {
                        staged.push_back(sub);
                    } else {
                        env.storage()
                            .persistent()
                            .set(&DataKey::Subscription(sub_id), &sub);
                    }
                    successful += 1;
                }
                OperationType::Charge => {
                    let existing: Option<SubscriptionRecord> = env
                        .storage()
                        .persistent()
                        .get(&DataKey::Subscription(sub_id));
                    if existing.is_none() {
                        failed += 1;
                        if atomic {
                            // Any failure aborts for atomic batches.
                            break;
                        }
                        continue;
                    }
                    let mut sub = existing.unwrap();
                    let amount = op.params.get(idx).unwrap_or(0);
                    sub.charged += amount;
                    if atomic {
                        staged.push_back(sub);
                    } else {
                        env.storage()
                            .persistent()
                            .set(&DataKey::Subscription(sub_id), &sub);
                    }
                    successful += 1;
                }
            }
        }

        let rolled_back = atomic && failed > 0;
        if rolled_back {
            successful = 0;
        } else if atomic {
            for sub in staged.iter() {
                env.storage()
                    .persistent()
                    .set(&DataKey::Subscription(sub.id), &sub);
            }
        }

        let state = if rolled_back {
            BatchState::Failed
        } else if failed == 0 {
            BatchState::Completed
        } else {
            BatchState::PartiallyCompleted
        };

        env.storage()
            .persistent()
            .set(&DataKey::BatchExecuted(batch_id), &true);
        env.storage()
            .persistent()
            .set(&DataKey::BatchStatus(batch_id), &BatchStatus { state });

        Ok(BatchResult {
            total_operations: total,
            successful_operations: successful,
            failed_operations: failed,
            gas_estimate,
            rolled_back,
        })
    }
}
