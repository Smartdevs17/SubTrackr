#![no_std]
#![allow(clippy::too_many_arguments)]

//! Batch subscription operations.
//!
//! A batch bundles one operation kind (create / update / charge / cancel) over
//! many subscriptions so merchants pay one transaction fee instead of `n`.
//!
//! Guarantees offered here:
//!
//! * **Atomic execution** — an atomic batch stages every write and discards the
//!   whole staging area if any item fails, so callers never observe a partial
//!   apply.
//! * **Status tracking** — every batch moves `Pending -> Processing ->
//!   {Completed, PartiallyCompleted, Failed}`, with start/finish timestamps.
//! * **Rollback** — a batch that already committed can still be undone with
//!   [`SubTrackrBatch::rollback_batch`], which restores the pre-execution
//!   snapshot captured during execute.
//! * **Analytics** — aggregate counts, success rate (basis points) and
//!   execution timing are maintained per operation type and in total.
//! * **Per-operation configuration** — batch size ceiling, default atomicity
//!   and rollback eligibility are configured independently for each
//!   [`OperationType`].

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Map, Vec,
};
use subtrackr_types::CoreError;

/// Default ceiling on items in one batch, used when an operation type has no
/// explicit configuration.
pub const MAX_BATCH_ITEMS: u32 = 100;
const GAS_BASE: u64 = 50_000;
const GAS_PER_ITEM: u64 = 100_000;
/// Denominator for the basis-point success rate reported by analytics.
pub const BPS_DENOMINATOR: u32 = 10_000;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum BatchError {
    InvalidBatch = 1,
    AlreadyExecuted = 2,
    NotExecuted = 3,
    RollbackNotAllowed = 4,
    AlreadyRolledBack = 5,
    Unauthorized = 6,
    BatchNotFound = 7,
}

impl From<BatchError> for CoreError {
    fn from(err: BatchError) -> Self {
        match err {
            BatchError::InvalidBatch => CoreError::InvalidConfig,
            BatchError::AlreadyExecuted
            | BatchError::NotExecuted
            | BatchError::RollbackNotAllowed
            | BatchError::AlreadyRolledBack => CoreError::InvalidStateTransition,
            BatchError::Unauthorized => CoreError::Unauthorized,
            BatchError::BatchNotFound => CoreError::NotFound,
        }
    }
}

impl From<CoreError> for BatchError {
    fn from(err: CoreError) -> Self {
        match err {
            CoreError::InvalidConfig => BatchError::InvalidBatch,
            CoreError::InvalidStateTransition => BatchError::AlreadyExecuted,
            CoreError::Unauthorized | CoreError::OwnerMismatch => BatchError::Unauthorized,
            CoreError::NotFound => BatchError::BatchNotFound,
            _ => BatchError::InvalidBatch,
        }
    }
}

/// The kind of operation applied to every subscription in a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationType {
    Create,
    Charge,
    Update,
    Cancel,
}

/// Reason recorded against each subscription in a cancel batch. Encoded in
/// [`BatchOperation::params`] as the code returned by [`cancel_reason_code`].
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CancelReason {
    TooExpensive,
    NoLongerNeeded,
    FoundAlternative,
    PoorService,
    Other,
}

/// Maps a cancel reason onto the integer stored in `params`.
pub fn cancel_reason_code(reason: &CancelReason) -> i128 {
    match reason {
        CancelReason::TooExpensive => 0,
        CancelReason::NoLongerNeeded => 1,
        CancelReason::FoundAlternative => 2,
        CancelReason::PoorService => 3,
        CancelReason::Other => 4,
    }
}

/// Inverse of [`cancel_reason_code`]; unknown codes fall back to `Other`.
pub fn cancel_reason_from_code(code: i128) -> CancelReason {
    match code {
        0 => CancelReason::TooExpensive,
        1 => CancelReason::NoLongerNeeded,
        2 => CancelReason::FoundAlternative,
        3 => CancelReason::PoorService,
        _ => CancelReason::Other,
    }
}

/// One operation applied to many subscriptions.
///
/// `params[i]` is the scalar argument for `subscription_ids[i]`: the charge
/// amount for `Charge`, the new price for `Update`, and the cancel reason code
/// for `Cancel`. `Create` reads it as the initial price.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchOperation {
    pub operation_type: OperationType,
    pub subscription_ids: Vec<u64>,
    pub params: Vec<i128>,
}

/// Lifecycle state of a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchState {
    /// Created but not yet executed.
    Pending,
    /// Execution has begun; items are being applied.
    Processing,
    /// Every item succeeded.
    Completed,
    /// Some items succeeded, some failed (non-atomic batches only).
    PartiallyCompleted,
    /// Execution failed; an atomic batch discarded all writes.
    Failed,
    /// A committed batch was explicitly undone via `rollback_batch`.
    RolledBack,
}

/// Tunables applied to a single [`OperationType`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchConfig {
    /// Hard ceiling on items in one batch of this type.
    pub max_items: u32,
    /// Atomicity used when the caller does not state a preference.
    pub atomic_default: bool,
    /// Whether committed batches of this type may be rolled back afterwards.
    pub allow_rollback: bool,
    /// Marginal gas charged per item, used by the gas estimate.
    pub gas_per_item: u64,
}

/// Progress snapshot returned by `get_batch_status`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchStatus {
    pub state: BatchState,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    /// Ledger timestamp at which execution started, `0` while pending.
    pub started_at: u64,
    /// Ledger timestamp at which execution finished, `0` while unfinished.
    pub completed_at: u64,
    /// `completed_at - started_at`, in seconds.
    pub duration: u64,
}

/// Outcome for a single subscription in a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OperationResult {
    pub subscription_id: u64,
    pub success: bool,
    /// `0` on success, otherwise a [`CoreError`] discriminant.
    pub code: u32,
}

/// Aggregate result of executing a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchResult {
    pub batch_id: u64,
    pub total_operations: u32,
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub gas_estimate: u64,
    pub rolled_back: bool,
    pub results: Vec<OperationResult>,
    /// Wall-clock seconds spent executing, from the ledger timestamp.
    pub duration: u64,
}

/// Aggregate execution statistics, kept globally and per operation type.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchAnalytics {
    pub total_batches: u32,
    pub completed_batches: u32,
    pub partial_batches: u32,
    pub failed_batches: u32,
    pub rolled_back_batches: u32,
    pub total_items: u32,
    pub successful_items: u32,
    pub failed_items: u32,
    /// `successful_items / total_items` in basis points (10_000 == 100%).
    pub success_rate_bps: u32,
    pub total_duration: u64,
    /// `total_duration / total_batches`, in seconds.
    pub avg_duration: u64,
}

impl BatchAnalytics {
    fn empty() -> Self {
        BatchAnalytics {
            total_batches: 0,
            completed_batches: 0,
            partial_batches: 0,
            failed_batches: 0,
            rolled_back_batches: 0,
            total_items: 0,
            successful_items: 0,
            failed_items: 0,
            success_rate_bps: 0,
            total_duration: 0,
            avg_duration: 0,
        }
    }

    fn recompute_derived(&mut self) {
        self.success_rate_bps = if self.total_items == 0 {
            0
        } else {
            ((self.successful_items as u64 * BPS_DENOMINATOR as u64) / self.total_items as u64)
                as u32
        };
        self.avg_duration = if self.total_batches == 0 {
            0
        } else {
            self.total_duration / self.total_batches as u64
        };
    }
}

/// Subscription state owned by the batch registry.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionRecord {
    pub id: u64,
    pub charged: i128,
    pub price: i128,
    pub active: bool,
}

/// Pre-execution snapshot of one subscription, used to undo a committed batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotEntry {
    pub id: u64,
    /// False when the batch created this subscription, so rollback deletes it.
    pub existed: bool,
    pub prior: SubscriptionRecord,
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
    BatchRolledBack(u64),
    BatchStatus(u64),
    BatchResult(u64),
    BatchSnapshot(u64),
    Config(OperationType),
    Analytics,
    AnalyticsFor(OperationType),
    Subscription(u64),
    History,
}

/// Configuration applied to an operation type that has never been configured.
pub fn default_config(operation_type: &OperationType) -> BatchConfig {
    match operation_type {
        // Creates are cheap, so they get the largest batches; a mistaken create
        // is undone by rolling the batch back.
        OperationType::Create => BatchConfig {
            max_items: MAX_BATCH_ITEMS,
            atomic_default: false,
            allow_rollback: true,
            gas_per_item: GAS_PER_ITEM,
        },
        // Money movement defaults to atomic so a merchant never half-bills a
        // cohort, and stays reversible for a mistaken billing run.
        OperationType::Charge => BatchConfig {
            max_items: 50,
            atomic_default: true,
            allow_rollback: true,
            gas_per_item: GAS_PER_ITEM,
        },
        OperationType::Update => BatchConfig {
            max_items: MAX_BATCH_ITEMS,
            atomic_default: false,
            allow_rollback: true,
            gas_per_item: GAS_PER_ITEM,
        },
        // Cancellation is customer-visible and terminal: keep batches small and
        // require an explicit re-subscribe rather than a silent undo.
        OperationType::Cancel => BatchConfig {
            max_items: 50,
            atomic_default: false,
            allow_rollback: false,
            gas_per_item: GAS_PER_ITEM,
        },
    }
}

/// A batch is valid when it targets at least one subscription, stays within
/// `max_items`, and supplies one `params` entry per subscription for the
/// operations that need one.
pub fn validate_batch_operation_with_limit(op: &BatchOperation, max_items: u32) -> bool {
    let n = op.subscription_ids.len();
    if n == 0 || n > max_items {
        return false;
    }
    match op.operation_type {
        // The initial price is optional on create.
        OperationType::Create => true,
        OperationType::Charge | OperationType::Update => op.params.len() == n,
        // A cancel reason per subscription is optional; omitting all of them
        // records `TooExpensive`'s neighbour `Other` for every item.
        OperationType::Cancel => op.params.is_empty() || op.params.len() == n,
    }
}

/// [`validate_batch_operation_with_limit`] against the default ceiling.
pub fn validate_batch_operation(op: &BatchOperation) -> bool {
    validate_batch_operation_with_limit(op, MAX_BATCH_ITEMS)
}

/// Gas estimate: a fixed base plus a per-item cost.
pub fn estimate_batch_gas_with_rate(op: &BatchOperation, gas_per_item: u64) -> u64 {
    GAS_BASE + (op.subscription_ids.len() as u64) * gas_per_item
}

/// [`estimate_batch_gas_with_rate`] at the default per-item rate.
pub fn estimate_batch_gas(op: &BatchOperation) -> u64 {
    estimate_batch_gas_with_rate(op, GAS_PER_ITEM)
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
        env.storage()
            .instance()
            .set(&DataKey::Analytics, &BatchAnalytics::empty());
    }

    // ── Configuration ────────────────────────────────────────────────────

    /// Replace the configuration for one operation type. Admin only.
    pub fn set_batch_config(
        env: Env,
        caller: Address,
        operation_type: OperationType,
        config: BatchConfig,
    ) -> Result<(), BatchError> {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BatchError::Unauthorized)?;
        if admin != caller {
            return Err(BatchError::Unauthorized);
        }
        if config.max_items == 0 || config.max_items > MAX_BATCH_ITEMS {
            return Err(BatchError::InvalidBatch);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Config(operation_type), &config);
        Ok(())
    }

    /// Effective configuration for an operation type, falling back to
    /// [`default_config`].
    pub fn get_batch_config(env: Env, operation_type: OperationType) -> BatchConfig {
        env.storage()
            .persistent()
            .get(&DataKey::Config(operation_type.clone()))
            .unwrap_or_else(|| default_config(&operation_type))
    }

    // ── Subscription registry ────────────────────────────────────────────

    pub fn seed_subscription(env: Env, subscription_id: u64) {
        let sub = SubscriptionRecord {
            id: subscription_id,
            charged: 0,
            price: 0,
            active: true,
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

    // ── Batch lifecycle ──────────────────────────────────────────────────

    /// Register a batch for later execution. `atomic` overrides the operation
    /// type's `atomic_default`; use [`Self::create_batch_operation_default`] to
    /// accept the configured default instead.
    pub fn create_batch_operation(
        env: Env,
        owner: Address,
        operation: BatchOperation,
        atomic: bool,
    ) -> Result<u64, BatchError> {
        owner.require_auth();
        let config = Self::get_batch_config(env.clone(), operation.operation_type.clone());
        if !validate_batch_operation_with_limit(&operation, config.max_items) {
            return Err(BatchError::InvalidBatch);
        }

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BatchCount)
            .unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::BatchCount, &count);

        let total = operation.subscription_ids.len();
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
        env.storage()
            .persistent()
            .set(&DataKey::BatchRolledBack(count), &false);
        env.storage().persistent().set(
            &DataKey::BatchStatus(count),
            &BatchStatus {
                state: BatchState::Pending,
                total,
                succeeded: 0,
                failed: 0,
                started_at: 0,
                completed_at: 0,
                duration: 0,
            },
        );

        let mut history: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::History)
            .unwrap_or(Vec::new(&env));
        history.push_back(count);
        env.storage().instance().set(&DataKey::History, &history);

        env.events()
            .publish((symbol_short!("batch"), symbol_short!("created")), count);

        Ok(count)
    }

    /// Register a batch using the operation type's configured default atomicity.
    pub fn create_batch_operation_default(
        env: Env,
        owner: Address,
        operation: BatchOperation,
    ) -> Result<u64, BatchError> {
        let config = Self::get_batch_config(env.clone(), operation.operation_type.clone());
        Self::create_batch_operation(env, owner, operation, config.atomic_default)
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
                total: 0,
                succeeded: 0,
                failed: 0,
                started_at: 0,
                completed_at: 0,
                duration: 0,
            })
    }

    /// Result recorded by the execution of `batch_id`, if it has run.
    pub fn get_batch_result(env: Env, batch_id: u64) -> Option<BatchResult> {
        env.storage()
            .persistent()
            .get(&DataKey::BatchResult(batch_id))
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
        let config = Self::get_batch_config(env.clone(), op.operation_type.clone());

        let total = op.subscription_ids.len();
        let gas_estimate = estimate_batch_gas_with_rate(&op, config.gas_per_item);
        let started_at = env.ledger().timestamp();

        Self::write_status(
            &env,
            batch_id,
            BatchStatus {
                state: BatchState::Processing,
                total,
                succeeded: 0,
                failed: 0,
                started_at,
                completed_at: 0,
                duration: 0,
            },
        );

        let mut successful: u32 = 0;
        let mut failed: u32 = 0;
        let mut results: Vec<OperationResult> = Vec::new(&env);
        let mut snapshot: Vec<SnapshotEntry> = Vec::new(&env);
        // Writes are staged for atomic batches and flushed only once every item
        // has succeeded, so a failure leaves no partial effects behind.
        let mut staged: Map<u64, SubscriptionRecord> = Map::new(&env);
        // Subscriptions already snapshotted, so a batch that touches the same id
        // twice still restores the state from before the whole batch.
        let mut snapshotted: Map<u64, bool> = Map::new(&env);

        for (i, sub_id) in op.subscription_ids.iter().enumerate() {
            let idx: u32 = i as u32;
            let param = op.params.get(idx).unwrap_or(0);
            let existing: Option<SubscriptionRecord> = staged.get(sub_id).or_else(|| {
                env.storage()
                    .persistent()
                    .get(&DataKey::Subscription(sub_id))
            });

            match Self::apply_item(&op.operation_type, sub_id, param, existing.clone()) {
                Ok(updated) => {
                    if !snapshotted.contains_key(sub_id) {
                        snapshotted.set(sub_id, true);
                        snapshot.push_back(SnapshotEntry {
                            id: sub_id,
                            existed: existing.is_some(),
                            prior: existing.unwrap_or(SubscriptionRecord {
                                id: sub_id,
                                charged: 0,
                                price: 0,
                                active: false,
                            }),
                        });
                    }
                    if atomic {
                        staged.set(sub_id, updated);
                    } else {
                        env.storage()
                            .persistent()
                            .set(&DataKey::Subscription(sub_id), &updated);
                    }
                    successful += 1;
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
                    if atomic {
                        // Any failure aborts an atomic batch; nothing staged is
                        // ever written.
                        break;
                    }
                }
            }
        }

        let rolled_back = atomic && failed > 0;
        if rolled_back {
            successful = 0;
        } else if atomic {
            for (id, record) in staged.iter() {
                env.storage()
                    .persistent()
                    .set(&DataKey::Subscription(id), &record);
            }
        }

        let state = if rolled_back {
            BatchState::Failed
        } else if failed == 0 {
            BatchState::Completed
        } else {
            BatchState::PartiallyCompleted
        };

        let completed_at = env.ledger().timestamp();
        let duration = completed_at.saturating_sub(started_at);

        env.storage()
            .persistent()
            .set(&DataKey::BatchExecuted(batch_id), &true);
        // An atomic batch that rolled back committed nothing, so there is
        // nothing left for `rollback_batch` to undo.
        if !rolled_back {
            env.storage()
                .persistent()
                .set(&DataKey::BatchSnapshot(batch_id), &snapshot);
        }
        Self::write_status(
            &env,
            batch_id,
            BatchStatus {
                state: state.clone(),
                total,
                succeeded: successful,
                failed,
                started_at,
                completed_at,
                duration,
            },
        );

        let result = BatchResult {
            batch_id,
            total_operations: total,
            successful_operations: successful,
            failed_operations: failed,
            gas_estimate,
            rolled_back,
            results,
            duration,
        };
        env.storage()
            .persistent()
            .set(&DataKey::BatchResult(batch_id), &result);

        Self::record_analytics(
            &env,
            &op.operation_type,
            &state,
            total,
            successful,
            failed,
            duration,
        );

        env.events().publish(
            (symbol_short!("batch"), symbol_short!("executed")),
            (batch_id, successful, failed),
        );

        Ok(result)
    }

    /// Undo a committed batch by restoring the snapshot captured during
    /// execution. Only the batch owner or the admin may call this, and only for
    /// operation types whose configuration sets `allow_rollback`.
    pub fn rollback_batch(
        env: Env,
        caller: Address,
        batch_id: u64,
    ) -> Result<BatchStatus, BatchError> {
        caller.require_auth();

        let op: BatchOperation = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .ok_or(BatchError::BatchNotFound)?;
        let owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::BatchOwner(batch_id))
            .ok_or(BatchError::BatchNotFound)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BatchError::Unauthorized)?;
        if caller != owner && caller != admin {
            return Err(BatchError::Unauthorized);
        }

        let executed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BatchExecuted(batch_id))
            .unwrap_or(false);
        if !executed {
            return Err(BatchError::NotExecuted);
        }
        let already: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BatchRolledBack(batch_id))
            .unwrap_or(false);
        if already {
            return Err(BatchError::AlreadyRolledBack);
        }

        let config = Self::get_batch_config(env.clone(), op.operation_type.clone());
        if !config.allow_rollback {
            return Err(BatchError::RollbackNotAllowed);
        }

        let snapshot: Vec<SnapshotEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::BatchSnapshot(batch_id))
            // An atomic batch that failed committed nothing, so there is no
            // snapshot and nothing to undo.
            .ok_or(BatchError::RollbackNotAllowed)?;

        for entry in snapshot.iter() {
            if entry.existed {
                env.storage()
                    .persistent()
                    .set(&DataKey::Subscription(entry.id), &entry.prior);
            } else {
                env.storage()
                    .persistent()
                    .remove(&DataKey::Subscription(entry.id));
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::BatchRolledBack(batch_id), &true);
        env.storage()
            .persistent()
            .remove(&DataKey::BatchSnapshot(batch_id));

        let previous = Self::get_batch_status(env.clone(), batch_id);
        let status = BatchStatus {
            state: BatchState::RolledBack,
            total: previous.total,
            succeeded: 0,
            failed: previous.failed,
            started_at: previous.started_at,
            completed_at: env.ledger().timestamp(),
            duration: previous.duration,
        };
        Self::write_status(&env, batch_id, status.clone());

        // Undoing the writes also undoes their contribution to the success rate.
        Self::discount_analytics(&env, &op.operation_type, previous.succeeded);

        env.events().publish(
            (symbol_short!("batch"), symbol_short!("rolledbk")),
            batch_id,
        );

        Ok(status)
    }

    // ── Analytics ────────────────────────────────────────────────────────

    /// Aggregate statistics across every batch executed by this contract.
    pub fn get_batch_analytics(env: Env) -> BatchAnalytics {
        env.storage()
            .instance()
            .get(&DataKey::Analytics)
            .unwrap_or_else(BatchAnalytics::empty)
    }

    /// Aggregate statistics restricted to one operation type.
    pub fn get_batch_analytics_for(env: Env, operation_type: OperationType) -> BatchAnalytics {
        env.storage()
            .persistent()
            .get(&DataKey::AnalyticsFor(operation_type))
            .unwrap_or_else(BatchAnalytics::empty)
    }

    // ── Internals ────────────────────────────────────────────────────────

    /// Apply one item, returning the updated record or a [`CoreError`] code.
    fn apply_item(
        operation_type: &OperationType,
        sub_id: u64,
        param: i128,
        existing: Option<SubscriptionRecord>,
    ) -> Result<SubscriptionRecord, u32> {
        match operation_type {
            OperationType::Create => {
                if existing.is_some() {
                    return Err(CoreError::AlreadyExists as u32);
                }
                Ok(SubscriptionRecord {
                    id: sub_id,
                    charged: 0,
                    price: param,
                    active: true,
                })
            }
            OperationType::Charge => {
                let mut sub = existing.ok_or(CoreError::SubscriptionNotFound as u32)?;
                if !sub.active {
                    return Err(CoreError::SubscriptionNotActive as u32);
                }
                if param < 0 {
                    return Err(CoreError::InvalidAmount as u32);
                }
                sub.charged += param;
                Ok(sub)
            }
            OperationType::Update => {
                let mut sub = existing.ok_or(CoreError::SubscriptionNotFound as u32)?;
                if param < 0 {
                    return Err(CoreError::InvalidPrice as u32);
                }
                sub.price = param;
                Ok(sub)
            }
            OperationType::Cancel => {
                let mut sub = existing.ok_or(CoreError::SubscriptionNotFound as u32)?;
                if !sub.active {
                    return Err(CoreError::SubscriptionAlreadyCancelled as u32);
                }
                sub.active = false;
                Ok(sub)
            }
        }
    }

    fn write_status(env: &Env, batch_id: u64, status: BatchStatus) {
        env.storage()
            .persistent()
            .set(&DataKey::BatchStatus(batch_id), &status);
    }

    fn record_analytics(
        env: &Env,
        operation_type: &OperationType,
        state: &BatchState,
        total: u32,
        successful: u32,
        failed: u32,
        duration: u64,
    ) {
        let apply = |analytics: &mut BatchAnalytics| {
            analytics.total_batches += 1;
            analytics.total_items += total;
            analytics.successful_items += successful;
            analytics.failed_items += failed;
            analytics.total_duration += duration;
            match state {
                BatchState::Completed => analytics.completed_batches += 1,
                BatchState::PartiallyCompleted => analytics.partial_batches += 1,
                _ => analytics.failed_batches += 1,
            }
            analytics.recompute_derived();
        };

        let mut global = Self::get_batch_analytics(env.clone());
        apply(&mut global);
        env.storage().instance().set(&DataKey::Analytics, &global);

        let mut per_type = Self::get_batch_analytics_for(env.clone(), operation_type.clone());
        apply(&mut per_type);
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsFor(operation_type.clone()), &per_type);
    }

    fn discount_analytics(env: &Env, operation_type: &OperationType, succeeded: u32) {
        let apply = |analytics: &mut BatchAnalytics| {
            analytics.rolled_back_batches += 1;
            analytics.successful_items = analytics.successful_items.saturating_sub(succeeded);
            analytics.recompute_derived();
        };

        let mut global = Self::get_batch_analytics(env.clone());
        apply(&mut global);
        env.storage().instance().set(&DataKey::Analytics, &global);

        let mut per_type = Self::get_batch_analytics_for(env.clone(), operation_type.clone());
        apply(&mut per_type);
        env.storage()
            .persistent()
            .set(&DataKey::AnalyticsFor(operation_type.clone()), &per_type);
    }
}
