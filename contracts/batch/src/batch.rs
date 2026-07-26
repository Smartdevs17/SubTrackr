//! Batch value types and pure (storage-free) helpers.

use crate::MAX_BATCH_SIZE;
use soroban_sdk::{contracttype, Vec};
use subtrackr_types::SubscriptionId;

/// Reason supplied when a batch cancellation is requested.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CancelReason {
    TooExpensive,
    NoLongerNeeded,
    FoundAlternative,
    PoorService,
    Custom,
}

/// Filtering criteria for batch update operations.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchFilter {
    pub plan_change: Option<bool>,
    pub min_price: Option<i128>,
    pub max_price: Option<i128>,
    pub category: Option<Vec<u32>>,
}

/// The kind of operation applied across every subscription in a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationType {
    Create,
    Update,
    Charge,
    Pause,
    Resume,
    Cancel,
}

/// One operation applied to many subscriptions.
///
/// `params[i]` is the scalar argument (e.g. charge amount) for
/// `subscription_ids[i]`; a shorter `params` vector defaults missing entries
/// to `0`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchOperation {
    pub operation_type: OperationType,
    pub subscription_ids: Vec<SubscriptionId>,
    pub params: Vec<i128>,
    /// Optional per-subscription cancel reasons for cancel batches.
    pub cancel_reasons: Vec<CancelReason>,
    /// Optional filtering criteria for update batches.
    pub filter: Option<BatchFilter>,
}

/// Outcome for a single subscription within a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OperationResult {
    pub subscription_id: SubscriptionId,
    pub success: bool,
    /// `0` on success, otherwise an operation-specific failure code.
    pub code: u32,
    pub reason: Option<String>,
}

/// Aggregate result of executing a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchResult {
    pub batch_id: u64,
    pub total_operations: u32,
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub skipped_operations: u32,
    pub results: Vec<OperationResult>,
    pub atomic: bool,
    /// True when an atomic batch failed and all writes were discarded.
    pub rolled_back: bool,
    pub gas_estimate: u64,
}

/// Lifecycle state of a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchState {
    Pending,
    Completed,
    PartiallyCompleted,
    Failed,
}

/// Progress snapshot returned by `get_batch_status`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchStatus {
    pub batch_id: u64,
    pub state: BatchState,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
}

/// Internal subscription status tracked by the batch registry.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SubStatus {
    Active,
    Paused,
    Cancelled,
}

/// Internal subscription record used to make batch outcomes real.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubRecord {
    pub exists: bool,
    pub status: SubStatus,
    pub charged: i128,
}

/// A batch is valid when it targets at least one subscription and stays within
/// [`MAX_BATCH_SIZE`].
pub fn validate_batch_operation(op: &BatchOperation) -> bool {
    let n = op.subscription_ids.len();
    n > 0 && n <= MAX_BATCH_SIZE
}

/// Gas estimate: a fixed base plus a per-operation cost. Mirrors the documented
/// `50_000 + n * 100_000` model used by the client batching service.
pub fn estimate_batch_gas(op: &BatchOperation) -> u64 {
    const BASE_GAS: u64 = 50_000;
    const GAS_PER_OP: u64 = 100_000;
    BASE_GAS + (op.subscription_ids.len() as u64) * GAS_PER_OP
}
