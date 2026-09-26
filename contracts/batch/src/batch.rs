/// Batch module – shared types for the SubTrackr batch operations contract.
use soroban_sdk::{contracttype, String, Vec};
use subtrackr_types::SubscriptionId;

// ── Subscription status ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SubStatus {
    Active,
    Paused,
    Cancelled,
}

// ── Subscription record (lightweight on-chain representation) ─────────────────

#[contracttype]
#[derive(Clone)]
pub struct SubRecord {
    pub exists: bool,
    pub status: SubStatus,
    pub charged: i128,
}

// ── Operation types ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationType {
    Create,
    Charge,
    Update,
    Cancel,
    Noop,
}

// ── Cancellation reasons ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CancelReason {
    UserRequested,
    PaymentFailed,
    Expired,
    Custom,
}

// ── Batch operation input ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct BatchOperation {
    /// Ordered list of subscription IDs to process.
    pub subscription_ids: Vec<SubscriptionId>,
    /// Parallel i128 parameter per subscription (e.g. charge amount).
    pub params: Vec<i128>,
    /// Cancellation reasons aligned with subscription_ids for Cancel ops.
    pub cancel_reasons: Vec<CancelReason>,
    pub operation_type: OperationType,
}

// ── Per-operation result ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct OperationResult {
    pub subscription_id: SubscriptionId,
    pub success: bool,
    /// Non-zero error code on failure.
    pub code: u32,
    /// Optional human-readable reason.
    pub reason: Option<String>,
}

// ── Batch-wide result ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct BatchResult {
    pub results: Vec<OperationResult>,
    pub state: BatchState,
    pub total_operations: u32,
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub skipped_operations: u32,
    /// Whether all operations must succeed or all roll back.
    pub atomic: bool,
    /// True when an atomic batch was rolled back due to failure.
    pub rolled_back: bool,
}

// ── Batch execution state ─────────────────────────────────────────────────────

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

// ── Status summary returned to callers ───────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct BatchStatus {
    pub batch_id: u64,
    pub state: BatchState,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
}

// ── Optional filter for history queries ──────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct BatchFilter {
    pub operation_type: Option<OperationType>,
    pub state: Option<BatchState>,
}
