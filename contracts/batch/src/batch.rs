/// Batch module – shared types and pure helpers for the SubTrackr batch
/// operations contract.
use core::borrow::Borrow;

use soroban_sdk::{contracttype, String, Vec};
use subtrackr_types::{CoreError, SubscriptionId};

// ── Hard limits and default gas rates ─────────────────────────────────────────

/// Absolute ceiling on items per batch. A configured `max_items` may only be
/// lowered below this; it can never be raised above it.
pub const MAX_BATCH_ITEMS: u32 = 100;

/// Fixed overhead included in every gas estimate, covering dispatch and the
/// bookkeeping the contract does regardless of batch size.
pub const BATCH_GAS_BASE: u64 = 50_000;

/// Per-item gas charge used until an admin configures a different rate.
pub const DEFAULT_GAS_PER_ITEM: u64 = 100_000;

// ── Subscription status ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SubStatus {
    Active,
    Paused,
    Cancelled,
}

/// Minimal per-subscription record the batch contract needs to operate on.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubRecord {
    pub exists: bool,
    pub active: bool,
    pub status: SubStatus,
    /// Cumulative amount charged across every batch.
    pub charged: i128,
    /// Current price, used as the threshold that deactivates a subscription.
    pub price: i128,
}

impl SubRecord {
    /// Placeholder for a subscription that did not exist before a batch.
    /// `exists` distinguishes it from a real record.
    pub fn absent() -> Self {
        SubRecord {
            exists: false,
            active: false,
            status: SubStatus::Active,
            charged: 0,
            price: 0,
        }
    }

    /// Creates a fresh, active subscription at `price`.
    pub fn new(price: i128) -> Self {
        SubRecord {
            exists: true,
            active: true,
            status: SubStatus::Active,
            charged: 0,
            price,
        }
    }
}

// ── Operation types ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationType {
    Create,
    Charge,
    Update,
    Cancel,
    Noop,
}

// ── Cancellation reasons ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CancelReason {
    TooExpensive,
    NoLongerNeeded,
    FoundAlternative,
    PoorService,
    Other,
}

/// Encodes a cancellation reason as a stable numeric code.
///
/// The codes are part of the wire format callers persist alongside a
/// subscription, so they must stay stable across releases.
pub fn cancel_reason_code(reason: &CancelReason) -> u32 {
    match reason {
        CancelReason::TooExpensive => 1,
        CancelReason::NoLongerNeeded => 2,
        CancelReason::FoundAlternative => 3,
        CancelReason::PoorService => 4,
        CancelReason::Other => 5,
    }
}

/// Decodes a cancellation reason, degrading unknown codes to `Other` rather
/// than failing, so an old caller reading a newer code still gets a usable
/// value.
pub fn cancel_reason_from_code(code: u32) -> CancelReason {
    match code {
        1 => CancelReason::TooExpensive,
        2 => CancelReason::NoLongerNeeded,
        3 => CancelReason::FoundAlternative,
        4 => CancelReason::PoorService,
        _ => CancelReason::Other,
    }
}

// ── Batch operation input ────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchOperation {
    pub operation_type: OperationType,
    /// Ordered list of subscription IDs to process.
    pub subscription_ids: Vec<SubscriptionId>,
    /// Parallel i128 parameter per subscription (price for Create/Update,
    /// amount for Charge). Missing entries default to zero.
    pub params: Vec<i128>,
}

// ── Per-operation result ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OperationResult {
    pub subscription_id: SubscriptionId,
    pub success: bool,
    /// A `CoreError` code on failure, zero on success.
    pub code: u32,
    /// Optional human-readable reason.
    pub reason: Option<String>,
}

impl OperationResult {
    /// Builds a successful result.
    pub fn success(subscription_id: SubscriptionId) -> Self {
        OperationResult {
            subscription_id,
            success: true,
            code: 0,
            reason: None,
        }
    }

    /// Builds a failed result carrying a `CoreError` code and message.
    pub fn failure(
        env: &soroban_sdk::Env,
        subscription_id: SubscriptionId,
        code: CoreError,
        message: &str,
    ) -> Self {
        OperationResult {
            subscription_id,
            success: false,
            code: code as u32,
            reason: Some(String::from_str(env, message)),
        }
    }
}

// ── Batch execution state ────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchState {
    Pending,
    Executing,
    Completed,
    PartiallyCompleted,
    Failed,
    RolledBack,
}

// ── Batch-wide result ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchResult {
    /// Id of the batch this result belongs to.
    pub batch_id: u64,
    /// Estimated gas units for the whole batch, set at creation time.
    pub gas_estimate: u64,
    /// State the batch settled into.
    pub state: BatchState,
    pub results: Vec<OperationResult>,
    pub total_operations: u32,
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub skipped_operations: u32,
    /// Whether all operations had to succeed or all roll back.
    pub atomic: bool,
    /// True when an atomic batch was rolled back during execution.
    pub rolled_back: bool,
    /// Ledger seconds the execution took.
    pub duration: u64,
}

// ── Status summary returned to callers ───────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchStatus {
    pub batch_id: u64,
    pub state: BatchState,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub started_at: u64,
    pub completed_at: u64,
    pub duration: u64,
}

// ── Per-operation-type configuration ─────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchConfig {
    /// Upper bound on items per batch for this operation type.
    pub max_items: u32,
    /// Atomicity applied when the caller does not specify it.
    pub atomic_default: bool,
    /// Whether a completed batch of this type may be rolled back later.
    pub allow_rollback: bool,
    /// Gas charged per item, on top of `BATCH_GAS_BASE`.
    pub gas_per_item: u64,
}

/// Returns the default configuration for an operation type.
///
/// Money movement defaults to atomic because a partially applied charge is
/// worse than a rejected one; cancellation defaults to non-atomic and is not
/// reversible, so it is never rollback-eligible.
pub fn default_config<T>(operation_type: T) -> BatchConfig
where
    T: Borrow<OperationType>,
{
    let default = BatchConfig {
        max_items: MAX_BATCH_ITEMS,
        atomic_default: false,
        allow_rollback: true,
        gas_per_item: DEFAULT_GAS_PER_ITEM,
    };

    match operation_type.borrow() {
        OperationType::Create => default,
        OperationType::Charge => BatchConfig {
            atomic_default: true,
            ..default
        },
        OperationType::Update => default,
        OperationType::Cancel => BatchConfig {
            allow_rollback: false,
            ..default
        },
        OperationType::Noop => default,
    }
}

// ── Rollback snapshot ────────────────────────────────────────────────────────

/// Pre-batch value of a single subscription, captured so a rollback can put
/// it back exactly.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotEntry {
    pub subscription_id: SubscriptionId,
    /// Pre-batch value. `exists == false` means the subscription was absent
    /// and must be removed again on rollback.
    pub prior: SubRecord,
}

// ── Analytics ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchAnalytics {
    pub total_batches: u64,
    pub completed_batches: u64,
    pub partial_batches: u64,
    pub failed_batches: u64,
    pub rolled_back_batches: u64,
    pub total_items: u64,
    pub successful_items: u64,
    pub failed_items: u64,
    /// Success rate in basis points (10_000 == 100%).
    pub success_rate_bps: u32,
    /// Mean execution duration in ledger seconds.
    pub avg_duration: u64,
    /// Running total of durations, kept for computing the mean without
    /// retaining every past batch.
    pub total_duration: u64,
}

impl BatchAnalytics {
    /// A zeroed analytics record.
    pub fn empty() -> Self {
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
            avg_duration: 0,
            total_duration: 0,
        }
    }

    /// Recomputes the derived rate and mean from the running totals.
    fn refresh(&mut self) {
        self.success_rate_bps = if self.total_items == 0 {
            0
        } else {
            ((self.successful_items as u128 * 10_000) / self.total_items as u128) as u32
        };
        self.avg_duration = if self.total_batches == 0 {
            0
        } else {
            self.total_duration / self.total_batches
        };
    }

    /// Folds one executed batch into the running totals.
    pub fn record_execution(
        &mut self,
        state: &BatchState,
        total_items: u64,
        successful_items: u64,
        failed_items: u64,
        duration: u64,
    ) {
        self.total_batches += 1;
        self.total_items += total_items;
        self.successful_items += successful_items;
        self.failed_items += failed_items;
        self.total_duration += duration;

        match state {
            BatchState::Completed => self.completed_batches += 1,
            BatchState::PartiallyCompleted => self.partial_batches += 1,
            BatchState::Failed => self.failed_batches += 1,
            _ => {}
        }

        self.refresh();
    }

    /// Discounts a rolled-back batch's successes from the totals.
    ///
    /// A rollback undid work that was previously counted, so its successful
    /// items must stop contributing to the success rate.
    pub fn record_rollback(&mut self, successful_items: u64) {
        self.rolled_back_batches += 1;
        self.successful_items = self.successful_items.saturating_sub(successful_items);
        self.refresh();
    }
}

// ── Operation validation and gas estimation ──────────────────────────────────

/// Returns true when the operation can be queued.
///
/// A batch must contain at least one item and may not exceed
/// [`MAX_BATCH_ITEMS`]. `Update` rewrites every price, so it needs exactly one
/// parameter per subscription; the other operation types treat a missing
/// parameter as zero, but a `params` vector longer than the subscription list
/// is always a caller mistake.
pub fn validate_batch_operation(operation: &BatchOperation) -> bool {
    let count = operation.subscription_ids.len();
    if count == 0 || count > MAX_BATCH_ITEMS {
        return false;
    }

    let params = operation.params.len();
    match operation.operation_type {
        OperationType::Update => params == count,
        _ => params <= count,
    }
}

/// Estimates total gas units for an operation at the default per-item rate.
///
/// Saturates rather than overflowing so an oversized batch cannot provoke a
/// wrapped-around estimate.
pub fn estimate_batch_gas(operation: &BatchOperation) -> u64 {
    estimate_batch_gas_with_rate(operation, DEFAULT_GAS_PER_ITEM)
}

/// Estimates total gas units for an operation at an explicit per-item rate.
pub fn estimate_batch_gas_with_rate(operation: &BatchOperation, gas_per_item: u64) -> u64 {
    BATCH_GAS_BASE
        .saturating_add(gas_per_item.saturating_mul(operation.subscription_ids.len() as u64))
}
