#![no_std]
//! SubTrackr batch operations contract.
//!
//! Lets merchants apply one operation (`OperationType`) across many
//! subscriptions in a single call, with:
//! * partial-success handling (non-atomic) and all-or-nothing rollback (atomic),
//! * progress/status tracking via [`SubTrackrBatch::get_batch_status`],
//! * a per-item [`BatchResult`] breakdown, and
//! * an append-only audit history of every batch.
//!
//! The contract keeps a lightweight internal subscription registry so success
//! and failure are real (e.g. charging an unknown subscription fails), which is
//! what exercises the partial-success and rollback paths. In production the
//! per-item step would invoke the subscription/proxy contract; that call site is
//! [`SubTrackrBatch::apply_operation`].

mod batch;

pub use batch::{
    estimate_batch_gas, validate_batch_operation, BatchOperation, BatchResult, BatchState,
    BatchStatus, OperationResult, OperationType,
};

use batch::{SubRecord, SubStatus};
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Vec};
use subtrackr_types::SubscriptionId;

/// Largest batch accepted by [`validate_batch_operation`].
pub const MAX_BATCH_SIZE: u32 = 100;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum BatchError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidBatch = 3,
    BatchNotFound = 4,
    AlreadyExecuted = 5,
    Unauthorized = 6,
}

type BatchId = u64;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    NextId,
    Batch(BatchId),
    Result(BatchId),
    Sub(SubscriptionId),
    History,
}

/// A stored batch and its lifecycle bookkeeping.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StoredBatch {
    pub id: BatchId,
    pub owner: Address,
    pub operation: BatchOperation,
    pub atomic: bool,
    pub state: BatchState,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub created_at: u64,
}

#[contract]
pub struct SubTrackrBatch;

#[contractimpl]
impl SubTrackrBatch {
    /// One-time initialization recording the admin.
    pub fn initialize(env: Env, admin: Address) -> Result<(), BatchError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(BatchError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextId, &0u64);
        Ok(())
    }

    /// Records a pending batch and returns its id. Validates size/shape up front.
    pub fn create_batch_operation(
        env: Env,
        owner: Address,
        op: BatchOperation,
        atomic: bool,
    ) -> Result<BatchId, BatchError> {
        owner.require_auth();
        if !validate_batch_operation(&op) {
            return Err(BatchError::InvalidBatch);
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .ok_or(BatchError::NotInitialized)?;
        let total = op.subscription_ids.len();
        let stored = StoredBatch {
            id,
            owner,
            operation: op,
            atomic,
            state: BatchState::Pending,
            total,
            succeeded: 0,
            failed: 0,
            created_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Batch(id), &stored);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let mut history = Self::history(&env);
        history.push_back(id);
        env.storage().persistent().set(&DataKey::History, &history);

        Ok(id)
    }

    /// Executes a previously created batch.
    ///
    /// Non-atomic batches commit each successful item and report
    /// `Completed`/`PartiallyCompleted`. Atomic batches that hit any failure
    /// commit nothing and report `Failed` (rollback).
    pub fn execute_batch(env: Env, batch_id: BatchId) -> Result<BatchResult, BatchError> {
        let mut stored = Self::load_batch(&env, batch_id)?;
        stored.owner.require_auth();
        if stored.state != BatchState::Pending {
            return Err(BatchError::AlreadyExecuted);
        }

        let op = stored.operation.clone();
        let mut results: Vec<OperationResult> = Vec::new(&env);
        // (subscription_id, new record to commit) for successful items.
        let mut pending_writes: Vec<(SubscriptionId, SubRecord)> = Vec::new(&env);
        let mut succeeded = 0u32;
        let mut failed = 0u32;

        let mut i = 0u32;
        while i < op.subscription_ids.len() {
            let sub_id = op.subscription_ids.get(i).unwrap();
            let amount = op.params.get(i).unwrap_or(0);
            let current = Self::sub(&env, sub_id);
            match Self::apply_operation(&op.operation_type, sub_id, &current, amount) {
                Ok(updated) => {
                    succeeded += 1;
                    pending_writes.push_back((sub_id, updated));
                    results.push_back(OperationResult {
                        subscription_id: sub_id,
                        success: true,
                        code: 0,
                    });
                }
                Err(code) => {
                    failed += 1;
                    results.push_back(OperationResult {
                        subscription_id: sub_id,
                        success: false,
                        code,
                    });
                }
            }
            i += 1;
        }

        let rolled_back = stored.atomic && failed > 0;
        if !rolled_back {
            // Commit successful writes.
            let mut w = 0u32;
            while w < pending_writes.len() {
                let (sub_id, record) = pending_writes.get(w).unwrap();
                env.storage().persistent().set(&DataKey::Sub(sub_id), &record);
                w += 1;
            }
        }

        stored.succeeded = succeeded;
        stored.failed = failed;
        stored.state = if rolled_back {
            BatchState::Failed
        } else if failed == 0 {
            BatchState::Completed
        } else {
            BatchState::PartiallyCompleted
        };
        env.storage().persistent().set(&DataKey::Batch(batch_id), &stored);

        let result = BatchResult {
            batch_id,
            total_operations: stored.total,
            successful_operations: if rolled_back { 0 } else { succeeded },
            failed_operations: failed,
            results,
            atomic: stored.atomic,
            rolled_back,
            gas_estimate: estimate_batch_gas(&op),
        };
        env.storage().persistent().set(&DataKey::Result(batch_id), &result);

        env.events().publish(
            (symbol_short!("batch_exe"), batch_id),
            (stored.state.clone(), succeeded, failed),
        );
        Ok(result)
    }

    /// Returns progress/status for a batch.
    pub fn get_batch_status(env: Env, batch_id: BatchId) -> Result<BatchStatus, BatchError> {
        let stored = Self::load_batch(&env, batch_id)?;
        Ok(BatchStatus {
            batch_id,
            state: stored.state,
            total: stored.total,
            succeeded: stored.succeeded,
            failed: stored.failed,
        })
    }

    /// Returns the detailed per-item result of an executed batch.
    pub fn get_batch_result(env: Env, batch_id: BatchId) -> Result<BatchResult, BatchError> {
        env.storage()
            .persistent()
            .get(&DataKey::Result(batch_id))
            .ok_or(BatchError::BatchNotFound)
    }

    /// Append-only audit list of every batch id ever created.
    pub fn get_batch_history(env: Env) -> Vec<BatchId> {
        Self::history(&env)
    }

    /// Convenience: registers subscriptions so later batches (charge/cancel/etc.)
    /// have something to act on. Mirrors a `Create` batch for a single id.
    pub fn seed_subscription(env: Env, sub_id: SubscriptionId) {
        env.storage().persistent().set(
            &DataKey::Sub(sub_id),
            &SubRecord {
                exists: true,
                status: SubStatus::Active,
                charged: 0,
            },
        );
    }

    /// Reads the internal subscription record (for inspection/tests).
    pub fn get_subscription(env: Env, sub_id: SubscriptionId) -> Option<SubRecord> {
        let r = Self::sub(&env, sub_id);
        if r.exists {
            Some(r)
        } else {
            None
        }
    }

    // ---- internals --------------------------------------------------------

    /// Applies a single operation to one subscription record, returning the
    /// updated record on success or a non-zero failure code. This is the seam
    /// where a production contract would call the subscription/proxy contract.
    fn apply_operation(
        op: &OperationType,
        _sub_id: SubscriptionId,
        current: &SubRecord,
        amount: i128,
    ) -> Result<SubRecord, u32> {
        match op {
            OperationType::Create => {
                if current.exists {
                    return Err(1); // already exists
                }
                Ok(SubRecord {
                    exists: true,
                    status: SubStatus::Active,
                    charged: 0,
                })
            }
            OperationType::Charge => {
                if !current.exists {
                    return Err(2); // unknown subscription
                }
                if current.status != SubStatus::Active {
                    return Err(3); // not chargeable
                }
                if amount <= 0 {
                    return Err(4); // invalid amount
                }
                let mut updated = current.clone();
                updated.charged = current.charged.saturating_add(amount);
                Ok(updated)
            }
            OperationType::Pause | OperationType::Resume | OperationType::Cancel
            | OperationType::Update => {
                if !current.exists {
                    return Err(2);
                }
                let mut updated = current.clone();
                updated.status = match op {
                    OperationType::Pause => SubStatus::Paused,
                    OperationType::Resume => SubStatus::Active,
                    OperationType::Cancel => SubStatus::Cancelled,
                    _ => current.status.clone(),
                };
                Ok(updated)
            }
        }
    }

    fn load_batch(env: &Env, id: BatchId) -> Result<StoredBatch, BatchError> {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(id))
            .ok_or(BatchError::BatchNotFound)
    }

    fn sub(env: &Env, id: SubscriptionId) -> SubRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Sub(id))
            .unwrap_or(SubRecord {
                exists: false,
                status: SubStatus::Active,
                charged: 0,
            })
    }

    fn history(env: &Env) -> Vec<BatchId> {
        env.storage()
            .persistent()
            .get(&DataKey::History)
            .unwrap_or_else(|| Vec::new(env))
    }
}
