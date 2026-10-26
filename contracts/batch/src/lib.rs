#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

mod batch;

pub use batch::{
    cancel_reason_code, cancel_reason_from_code, default_config, estimate_batch_gas,
    estimate_batch_gas_with_rate, validate_batch_operation, BatchAnalytics, BatchConfig,
    BatchOperation, BatchResult, BatchState, BatchStatus, CancelReason, OperationResult,
    OperationType, SnapshotEntry, SubRecord, SubStatus, BATCH_GAS_BASE, DEFAULT_GAS_PER_ITEM,
    MAX_BATCH_ITEMS,
};

/// Contract-level errors.
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
    RollbackNotAllowed = 7,
    NotExecuted = 8,
    AlreadyRolledBack = 9,
}

/// Storage keys.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKey {
    Admin,
    /// Next batch id to hand out.
    NextBatchId,
    /// Append-only list of every batch id ever created.
    BatchHistory,
    BatchOperation(u64),
    BatchState(u64),
    BatchResult(u64),
    BatchStatus(u64),
    /// Creator of the batch, allowed to roll it back.
    BatchOwner(u64),
    BatchAtomic(u64),
    /// Pre-batch subscription values, used to undo an execution.
    BatchSnapshot(u64),
    Subscription(u64),
    /// Admin-configured override, absent when defaults apply.
    TypeConfig(OperationType),
    TypeAnalytics(OperationType),
    GlobalAnalytics,
}

#[contract]
pub struct SubTrackrBatch;

#[contractimpl]
impl SubTrackrBatch {
    // ── Setup ───────────────────────────────────────────────────────────────

    /// One-time initialization recording the admin allowed to configure and
    /// roll back batches.
    pub fn initialize(env: Env, admin: Address) -> Result<(), BatchError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(BatchError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextBatchId, &1u64);
        Ok(())
    }

    // ── Subscription fixtures ──────────────────────────────────────────────

    /// Creates an active subscription with a zero price.
    ///
    /// Intended for test fixtures and integration harnesses.
    pub fn seed_subscription(env: Env, subscription_id: u64) {
        let storage = env.storage().instance();
        storage.set(&DataKey::Subscription(subscription_id), &SubRecord::new(0));
    }

    /// Returns the stored subscription, or `None` when it does not exist.
    pub fn get_subscription(env: Env, subscription_id: u64) -> Option<SubRecord> {
        env.storage()
            .instance()
            .get(&DataKey::Subscription(subscription_id))
    }

    // ── Per-operation-type configuration ────────────────────────────────────

    /// Returns the configuration for an operation type, falling back to the
    /// shipped defaults when the admin has not overridden it.
    pub fn get_batch_config(env: Env, operation_type: OperationType) -> BatchConfig {
        env.storage()
            .instance()
            .get(&DataKey::TypeConfig(operation_type.clone()))
            .unwrap_or_else(|| default_config(operation_type))
    }

    /// Admin-only override of an operation type's configuration.
    pub fn set_batch_config(
        env: Env,
        caller: Address,
        operation_type: OperationType,
        config: BatchConfig,
    ) -> Result<(), BatchError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        // The hard ceiling may only be tightened, never lifted.
        if config.max_items == 0 || config.max_items > MAX_BATCH_ITEMS {
            return Err(BatchError::InvalidBatch);
        }

        env.storage()
            .instance()
            .set(&DataKey::TypeConfig(operation_type), &config);
        Ok(())
    }

    // ── Batch lifecycle ─────────────────────────────────────────────────────

    /// Queues a batch with explicit atomicity.
    pub fn create_batch_operation(
        env: Env,
        owner: Address,
        operation: BatchOperation,
        atomic: bool,
    ) -> Result<u64, BatchError> {
        owner.require_auth();
        Self::require_initialized(&env)?;

        if !validate_batch_operation(&operation) {
            return Err(BatchError::InvalidBatch);
        }

        let config = Self::get_batch_config(env.clone(), operation.operation_type.clone());
        if operation.subscription_ids.len() > config.max_items {
            return Err(BatchError::InvalidBatch);
        }

        let batch_id = Self::next_batch_id(&env);
        let total = operation.subscription_ids.len();
        let gas_estimate = estimate_batch_gas_with_rate(&operation, config.gas_per_item);

        let storage = env.storage().instance();
        storage.set(&DataKey::BatchOperation(batch_id), &operation);
        storage.set(&DataKey::BatchState(batch_id), &BatchState::Pending);
        storage.set(&DataKey::BatchOwner(batch_id), &owner);
        storage.set(&DataKey::BatchAtomic(batch_id), &atomic);

        storage.set(
            &DataKey::BatchStatus(batch_id),
            &BatchStatus {
                batch_id,
                state: BatchState::Pending,
                total,
                succeeded: 0,
                failed: 0,
                started_at: 0,
                completed_at: 0,
                duration: 0,
            },
        );

        storage.set(
            &DataKey::BatchResult(batch_id),
            &BatchResult {
                batch_id,
                gas_estimate,
                state: BatchState::Pending,
                results: Vec::new(&env),
                total_operations: total,
                successful_operations: 0,
                failed_operations: 0,
                skipped_operations: 0,
                atomic,
                rolled_back: false,
                duration: 0,
            },
        );

        let mut history: Vec<u64> = storage
            .get(&DataKey::BatchHistory)
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(batch_id);
        storage.set(&DataKey::BatchHistory, &history);
        storage.set(&DataKey::NextBatchId, &(batch_id + 1));

        Ok(batch_id)
    }

    /// Queues a batch using the configured default atomicity for its type.
    pub fn create_batch_operation_default(
        env: Env,
        owner: Address,
        operation: BatchOperation,
    ) -> Result<u64, BatchError> {
        let atomic =
            Self::get_batch_config(env.clone(), operation.operation_type.clone()).atomic_default;
        Self::create_batch_operation(env, owner, operation, atomic)
    }

    /// Alias of [`create_batch_operation`](Self::create_batch_operation).
    pub fn create_batch(
        env: Env,
        owner: Address,
        operation: BatchOperation,
        atomic: bool,
    ) -> Result<u64, BatchError> {
        Self::create_batch_operation(env, owner, operation, atomic)
    }

    /// Executes a pending batch and settles it.
    ///
    /// In atomic mode the first failure aborts the batch and restores every
    /// touched subscription to its pre-batch value.
    pub fn execute_batch(env: Env, batch_id: u64) -> Result<BatchResult, BatchError> {
        Self::require_initialized(&env)?;

        let storage = env.storage().instance();
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
        let atomic: bool = storage
            .get(&DataKey::BatchAtomic(batch_id))
            .unwrap_or(false);

        let started_at = env.ledger().timestamp();
        storage.set(&DataKey::BatchState(batch_id), &BatchState::Executing);

        let total = operation.subscription_ids.len();
        let mut snapshot: Vec<SnapshotEntry> = Vec::new(&env);
        let mut successful = 0u32;
        let mut failed = 0u32;
        let mut saw_failure = false;

        let mut idx = 0u32;
        while idx < total {
            let subscription_id = operation.subscription_ids.get(idx).unwrap();
            let amount = operation.params.get(idx).unwrap_or(0);

            let prior: Option<SubRecord> = storage.get(&DataKey::Subscription(subscription_id));
            Self::capture_snapshot(&mut snapshot, subscription_id, prior.clone());

            let op_result = match operation.operation_type {
                OperationType::Create => Self::execute_create(&env, subscription_id, amount, prior),
                OperationType::Charge => Self::execute_charge(&env, subscription_id, amount, prior),
                OperationType::Update => Self::execute_update(&env, subscription_id, amount, prior),
                OperationType::Cancel => Self::execute_cancel(&env, subscription_id, prior),
                OperationType::Noop => OperationResult::success(subscription_id),
            };

            if op_result.success {
                successful += 1;
            } else {
                failed += 1;
                saw_failure = true;
            }

            result.results.push_back(op_result);

            idx += 1;

            // Atomic batches stop at the first failure; everything left is
            // reported as skipped and the whole batch is undone below.
            if saw_failure && atomic {
                result.skipped_operations = total - idx;
                break;
            }
        }

        // Persist the pre-batch values so a later `rollback_batch` call can
        // undo this execution.
        storage.set(&DataKey::BatchSnapshot(batch_id), &snapshot);

        if atomic && saw_failure {
            Self::restore_snapshot(&env, &snapshot);
            successful = 0;
            failed = 1;
            result.rolled_back = true;
            result.state = BatchState::Failed;
        } else {
            result.state = match (successful, failed) {
                (_, 0) => BatchState::Completed,
                (0, _) => BatchState::Failed,
                _ => BatchState::PartiallyCompleted,
            };
        }

        let completed_at = env.ledger().timestamp();
        let duration = completed_at.saturating_sub(started_at);

        result.successful_operations = successful;
        result.failed_operations = failed;
        result.duration = duration;

        let settled_state = result.state.clone();

        storage.set(&DataKey::BatchResult(batch_id), &result);
        storage.set(&DataKey::BatchState(batch_id), &settled_state);

        let mut status = Self::get_batch_status(env.clone(), batch_id);
        status.state = settled_state.clone();
        status.succeeded = successful;
        status.failed = failed;
        status.started_at = started_at;
        status.completed_at = completed_at;
        status.duration = duration;
        storage.set(&DataKey::BatchStatus(batch_id), &status);

        Self::record_execution_analytics(
            &env,
            &operation.operation_type,
            &settled_state,
            total as u64,
            successful as u64,
            failed as u64,
            duration,
        );

        Ok(result)
    }

    /// Undoes a completed batch, restoring every subscription it touched.
    ///
    /// Only the batch owner or the admin may roll back, and only when the
    /// operation type permits it and the batch did not already roll itself
    /// back during execution.
    pub fn rollback_batch(
        env: Env,
        caller: Address,
        batch_id: u64,
    ) -> Result<BatchStatus, BatchError> {
        caller.require_auth();
        Self::require_initialized(&env)?;

        let storage = env.storage().instance();
        let state: BatchState = storage
            .get(&DataKey::BatchState(batch_id))
            .ok_or(BatchError::NotFound)?;

        if state == BatchState::RolledBack {
            return Err(BatchError::AlreadyRolledBack);
        }
        if state == BatchState::Pending {
            return Err(BatchError::NotExecuted);
        }

        let result: BatchResult = storage
            .get(&DataKey::BatchResult(batch_id))
            .ok_or(BatchError::NotFound)?;

        // An atomic failure already restored everything; there is nothing
        // left to undo.
        if result.rolled_back {
            return Err(BatchError::RollbackNotAllowed);
        }

        let operation: BatchOperation = storage
            .get(&DataKey::BatchOperation(batch_id))
            .ok_or(BatchError::NotFound)?;

        let config = Self::get_batch_config(env.clone(), operation.operation_type.clone());
        if !config.allow_rollback {
            return Err(BatchError::RollbackNotAllowed);
        }

        let owner: Address = storage
            .get(&DataKey::BatchOwner(batch_id))
            .ok_or(BatchError::NotFound)?;
        let admin: Address = storage
            .get(&DataKey::Admin)
            .ok_or(BatchError::NotInitialized)?;
        if caller != owner && caller != admin {
            return Err(BatchError::Unauthorized);
        }

        let snapshot: Vec<SnapshotEntry> = storage
            .get(&DataKey::BatchSnapshot(batch_id))
            .unwrap_or_else(|| Vec::new(&env));
        Self::restore_snapshot(&env, &snapshot);
        storage.remove(&DataKey::BatchSnapshot(batch_id));

        storage.set(&DataKey::BatchState(batch_id), &BatchState::RolledBack);

        let mut status = Self::get_batch_status(env.clone(), batch_id);
        status.state = BatchState::RolledBack;
        storage.set(&DataKey::BatchStatus(batch_id), &status);

        Self::record_rollback_analytics(
            &env,
            &operation.operation_type,
            result.successful_operations as u64,
        );

        Ok(status)
    }

    // ── Read-only views ─────────────────────────────────────────────────────

    /// Every batch id ever created, oldest first.
    pub fn get_batch_history(env: Env) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::BatchHistory)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Status of a batch.
    ///
    /// An unknown `batch_id` yields a zeroed `Failed` status rather than an
    /// error, so a poller can distinguish "never created" by checking whether
    /// `total` is zero.
    pub fn get_batch_status(env: Env, batch_id: u64) -> BatchStatus {
        env.storage()
            .instance()
            .get(&DataKey::BatchStatus(batch_id))
            .unwrap_or(BatchStatus {
                batch_id,
                state: BatchState::Failed,
                total: 0,
                succeeded: 0,
                failed: 0,
                started_at: 0,
                completed_at: 0,
                duration: 0,
            })
    }

    pub fn get_batch_result(env: Env, batch_id: u64) -> Option<BatchResult> {
        env.storage()
            .instance()
            .get(&DataKey::BatchResult(batch_id))
    }

    /// Aggregate analytics across every operation type.
    pub fn get_batch_analytics(env: Env) -> BatchAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::GlobalAnalytics)
            .unwrap_or_else(BatchAnalytics::empty)
    }

    /// Aggregate analytics for a single operation type.
    pub fn get_batch_analytics_for(env: Env, operation_type: OperationType) -> BatchAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::TypeAnalytics(operation_type))
            .unwrap_or_else(BatchAnalytics::empty)
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /// Records a subscription's pre-batch value, keeping the *first* capture
    /// when a batch touches the same subscription twice so a rollback restores
    /// the state from before the batch, not midway through it.
    fn capture_snapshot(
        snapshot: &mut Vec<SnapshotEntry>,
        subscription_id: u64,
        prior: Option<SubRecord>,
    ) {
        for entry in snapshot.iter() {
            if entry.subscription_id == subscription_id {
                return;
            }
        }
        snapshot.push_back(SnapshotEntry {
            subscription_id,
            prior: prior.unwrap_or_else(SubRecord::absent),
        });
    }

    fn restore_snapshot(env: &Env, snapshot: &Vec<SnapshotEntry>) {
        let storage = env.storage().instance();
        for entry in snapshot.iter() {
            if entry.prior.exists {
                storage.set(&DataKey::Subscription(entry.subscription_id), &entry.prior);
            } else {
                storage.remove(&DataKey::Subscription(entry.subscription_id));
            }
        }
    }

    fn record_execution_analytics(
        env: &Env,
        operation_type: &OperationType,
        state: &BatchState,
        total_items: u64,
        successful_items: u64,
        failed_items: u64,
        duration: u64,
    ) {
        let storage = env.storage().instance();

        let mut global: BatchAnalytics = storage
            .get(&DataKey::GlobalAnalytics)
            .unwrap_or_else(BatchAnalytics::empty);
        global.record_execution(state, total_items, successful_items, failed_items, duration);
        storage.set(&DataKey::GlobalAnalytics, &global);

        let key = DataKey::TypeAnalytics(operation_type.clone());
        let mut per_type: BatchAnalytics = storage.get(&key).unwrap_or_else(BatchAnalytics::empty);
        per_type.record_execution(state, total_items, successful_items, failed_items, duration);
        storage.set(&key, &per_type);
    }

    fn record_rollback_analytics(env: &Env, operation_type: &OperationType, successful_items: u64) {
        let storage = env.storage().instance();

        let mut global: BatchAnalytics = storage
            .get(&DataKey::GlobalAnalytics)
            .unwrap_or_else(BatchAnalytics::empty);
        global.record_rollback(successful_items);
        storage.set(&DataKey::GlobalAnalytics, &global);

        let key = DataKey::TypeAnalytics(operation_type.clone());
        let mut per_type: BatchAnalytics = storage.get(&key).unwrap_or_else(BatchAnalytics::empty);
        per_type.record_rollback(successful_items);
        storage.set(&key, &per_type);
    }

    // ── Operation handlers ──────────────────────────────────────────────────

    fn execute_create(
        env: &Env,
        subscription_id: u64,
        price: i128,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        if prior.is_some() {
            return OperationResult::failure(
                env,
                subscription_id,
                subtrackr_types::CoreError::AlreadyExists,
                "AlreadyExists",
            );
        }
        env.storage().instance().set(
            &DataKey::Subscription(subscription_id),
            &SubRecord::new(price),
        );
        OperationResult::success(subscription_id)
    }

    fn execute_charge(
        env: &Env,
        subscription_id: u64,
        amount: i128,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        let mut record = match prior {
            Some(record) if record.exists => record,
            _ => {
                return OperationResult::failure(
                    env,
                    subscription_id,
                    subtrackr_types::CoreError::SubscriptionNotFound,
                    "SubscriptionNotFound",
                )
            }
        };

        if record.status != SubStatus::Active {
            return OperationResult::failure(
                env,
                subscription_id,
                subtrackr_types::CoreError::SubscriptionNotActive,
                "SubscriptionNotActive",
            );
        }

        record.charged += amount;
        if record.price > 0 && record.charged >= record.price {
            record.active = false;
        }
        record.status = SubStatus::Active;

        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id), &record);
        OperationResult::success(subscription_id)
    }

    fn execute_update(
        env: &Env,
        subscription_id: u64,
        price: i128,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        let mut record = match prior {
            Some(record) if record.exists => record,
            _ => {
                return OperationResult::failure(
                    env,
                    subscription_id,
                    subtrackr_types::CoreError::SubscriptionNotFound,
                    "SubscriptionNotFound",
                )
            }
        };

        record.price = price;
        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id), &record);
        OperationResult::success(subscription_id)
    }

    fn execute_cancel(
        env: &Env,
        subscription_id: u64,
        prior: Option<SubRecord>,
    ) -> OperationResult {
        let mut record = match prior {
            Some(record) if record.exists => record,
            _ => {
                return OperationResult::failure(
                    env,
                    subscription_id,
                    subtrackr_types::CoreError::SubscriptionNotFound,
                    "SubscriptionNotFound",
                )
            }
        };

        if record.status == SubStatus::Cancelled {
            return OperationResult::failure(
                env,
                subscription_id,
                subtrackr_types::CoreError::SubscriptionAlreadyCancelled,
                "SubscriptionAlreadyCancelled",
            );
        }

        record.status = SubStatus::Cancelled;
        record.active = false;
        env.storage()
            .instance()
            .set(&DataKey::Subscription(subscription_id), &record);
        OperationResult::success(subscription_id)
    }

    // ── Guards ──────────────────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), BatchError> {
        if env.storage().instance().has(&DataKey::Admin) {
            Ok(())
        } else {
            Err(BatchError::NotInitialized)
        }
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), BatchError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BatchError::NotInitialized)?;
        if *caller == admin {
            Ok(())
        } else {
            Err(BatchError::Unauthorized)
        }
    }

    fn next_batch_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextBatchId)
            .unwrap_or(1);
        id
    }
}
