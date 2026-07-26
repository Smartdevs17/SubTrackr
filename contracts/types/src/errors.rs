#![no_std]

use soroban_sdk::{contracterror, contracttype, Env, Symbol};

/// Unified core error enum for all SubTrackr contracts.
///
/// Categories:
/// - Auth: Authentication and authorization errors (1xx)
/// - Initialization: Initialization errors (2xx)
/// - Validation: Input validation errors (3xx)
/// - Payment: Payment and balance errors (4xx)
/// - State: State machine errors (5xx)
/// - Storage: Storage and persistence errors (6xx)
/// - External: External service errors (7xx)
/// - Recovery: Recovery errors (8xx)
#[contracterror]
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CoreError {
    // ── Auth Errors (1xx) ──
    Unauthorized = 100,
    OwnerMismatch = 101,
    InvalidCredentials = 102,
    ApiKeyRevoked = 103,
    ApiKeyExpired = 104,
    PermissionDenied = 105,

    // ── Initialization Errors (2xx) ──
    AlreadyInitialized = 200,
    NotInitialized = 201,

    // ── Validation Errors (3xx) ──
    NotFound = 300,
    PlanNotFound = 301,
    SubscriptionNotFound = 302,
    InvoiceNotFound = 303,
    FeedNotFound = 304,
    InvalidAmount = 305,
    InvalidInterval = 306,
    InvalidPriceBounds = 307,
    InvalidPrice = 308,
    InvalidTimestamp = 309,
    InvalidConfig = 310,
    AlreadyExists = 311,
    AlreadySubscribed = 312,
    FeedExists = 313,
    InvalidTimeoutConfig = 314,
    SelfTransfer = 315,

    // ── Payment Errors (4xx) ──
    InsufficientFunds = 400,
    InsufficientCredit = 401,
    PaymentNotYetDue = 402,
    PaymentTimedOut = 403,
    RefundExceedsTotalPaid = 404,

    // ── State Errors (5xx) ──
    SubscriptionNotActive = 500,
    SubscriptionAlreadyCancelled = 501,
    SubscriptionAlreadyPaused = 502,
    SubscriptionNotPaused = 503,
    PlanInactive = 504,
    MaxPauseDurationExceeded = 505,
    InvalidStateTransition = 506,
    CircuitOpen = 507,

    // ── Storage Errors (6xx) ──
    StorageVersionMismatch = 600,
    InvalidMigrationPath = 601,
    EventNotFound = 602,
    EventStoreFull = 603,
    InvalidEventSequence = 604,
    ExportWindowExceeded = 605,
    NoHistory = 606,

    // ── External Errors (7xx) ──
    OracleUnavailable = 700,
    NoPriceAvailable = 701,
    StalePrice = 702,
    ChainReorgDetected = 703,
    RateLimited = 704,

    // ── Recovery Errors (8xx) ──
    RecoveryAttemptsExhausted = 800,
    TransactionNotRecoverable = 801,
}

impl CoreError {
    pub fn user_message(self) -> &'static str {
        match self {
            Self::Unauthorized => "You are not authorized to perform this action.",
            Self::OwnerMismatch => "Only the resource owner can perform this action.",
            Self::InvalidCredentials => "Invalid credentials provided.",
            Self::ApiKeyRevoked => "API key has been revoked.",
            Self::ApiKeyExpired => "API key has expired.",
            Self::PermissionDenied => "You do not have permission to perform this action.",
            Self::AlreadyInitialized => "Contract already initialized.",
            Self::NotInitialized => "Contract not initialized.",
            Self::NotFound => "The requested resource was not found.",
            Self::PlanNotFound => "The requested plan does not exist.",
            Self::SubscriptionNotFound => "No active subscription found for this account.",
            Self::InvoiceNotFound => "The requested invoice does not exist.",
            Self::FeedNotFound => "The requested price feed does not exist.",
            Self::InvalidAmount => "Amount must be greater than zero.",
            Self::InvalidInterval => "Billing interval must be positive.",
            Self::InvalidPriceBounds => "Price bounds are invalid (max must be > min > 0).",
            Self::InvalidPrice => "Price must be greater than zero.",
            Self::InvalidTimestamp => "Invalid timestamp provided.",
            Self::InvalidConfig => "Invalid configuration provided.",
            Self::AlreadyExists => "This resource already exists.",
            Self::AlreadySubscribed => "You are already subscribed to this plan.",
            Self::FeedExists => "This price feed already exists.",
            Self::InvalidTimeoutConfig => "Timeout configuration values are out of allowed range.",
            Self::SelfTransfer => "Cannot transfer to self.",
            Self::InsufficientFunds => "Insufficient token balance or allowance to process payment.",
            Self::InsufficientCredit => "Insufficient credit balance.",
            Self::PaymentNotYetDue => "The next payment is not due yet.",
            Self::PaymentTimedOut => "Payment transaction timed out waiting for confirmation.",
            Self::RefundExceedsTotalPaid => "Refund amount exceeds total amount paid.",
            Self::SubscriptionNotActive => "This subscription is not currently active.",
            Self::SubscriptionAlreadyCancelled => "This subscription has already been cancelled.",
            Self::SubscriptionAlreadyPaused => "This subscription is already paused.",
            Self::SubscriptionNotPaused => "This subscription is not paused.",
            Self::PlanInactive => "This plan is no longer accepting new subscribers.",
            Self::MaxPauseDurationExceeded => "Pause duration exceeds the allowed maximum of 30 days.",
            Self::InvalidStateTransition => "Invalid state transition for the current resource state.",
            Self::CircuitOpen => "Oracle circuit breaker is open.",
            Self::StorageVersionMismatch => "Storage schema version mismatch; run migration first.",
            Self::InvalidMigrationPath => "Unsupported migration path.",
            Self::EventNotFound => "The requested event does not exist.",
            Self::EventStoreFull => "Event store has reached maximum capacity.",
            Self::InvalidEventSequence => "Invalid event sequence for subscription state.",
            Self::ExportWindowExceeded => "Export range exceeds the maximum allowed window.",
            Self::NoHistory => "No historical data available.",
            Self::OracleUnavailable => "Price oracle is temporarily unavailable.",
            Self::NoPriceAvailable => "No price available for this pair.",
            Self::StalePrice => "Price is stale.",
            Self::ChainReorgDetected => "Chain reorganisation detected during timeout window.",
            Self::RateLimited => "Too many requests. Please wait before retrying.",
            Self::RecoveryAttemptsExhausted => "All automatic recovery attempts have been exhausted.",
            Self::TransactionNotRecoverable => "Transaction is not in a recoverable state.",
        }
    }

    pub fn error_code(self) -> u32 {
        self as u32
    }

    pub fn emit_event(self, env: &Env) {
        env.events().publish((Symbol::new(env, "error"),), self);
    }
}

// ─── Deprecated Error Codes (for backward compatibility) ──────────────────────
#[deprecated(note = "Use CoreError::Unauthorized instead")]
pub const ERROR_UNAUTHORIZED: u32 = 1;
#[deprecated(note = "Use CoreError::PlanNotFound instead")]
pub const ERROR_PLAN_NOT_FOUND: u32 = 2;
#[deprecated(note = "Use CoreError::PlanInactive instead")]
pub const ERROR_PLAN_INACTIVE: u32 = 3;
#[deprecated(note = "Use CoreError::SubscriptionNotFound instead")]
pub const ERROR_SUBSCRIPTION_NOT_FOUND: u32 = 4;
#[deprecated(note = "Use CoreError::AlreadySubscribed instead")]
pub const ERROR_ALREADY_SUBSCRIBED: u32 = 5;
#[deprecated(note = "Use CoreError::SubscriptionNotActive instead")]
pub const ERROR_SUBSCRIPTION_NOT_ACTIVE: u32 = 6;
#[deprecated(note = "Use CoreError::SubscriptionAlreadyCancelled instead")]
pub const ERROR_SUBSCRIPTION_ALREADY_CANCELLED: u32 = 7;
#[deprecated(note = "Use CoreError::SubscriptionAlreadyPaused instead")]
pub const ERROR_SUBSCRIPTION_ALREADY_PAUSED: u32 = 8;
#[deprecated(note = "Use CoreError::SubscriptionNotPaused instead")]
pub const ERROR_SUBSCRIPTION_NOT_PAUSED: u32 = 9;
#[deprecated(note = "Use CoreError::PaymentNotYetDue instead")]
pub const ERROR_PAYMENT_NOT_YET_DUE: u32 = 10;
#[deprecated(note = "Use CoreError::InsufficientFunds instead")]
pub const ERROR_INSUFFICIENT_ALLOWANCE: u32 = 11;
#[deprecated(note = "Use CoreError::InvalidAmount instead")]
pub const ERROR_INVALID_AMOUNT: u32 = 12;
#[deprecated(note = "Use CoreError::InvalidInterval instead")]
pub const ERROR_INVALID_INTERVAL: u32 = 13;
#[deprecated(note = "Use CoreError::InvalidPriceBounds instead")]
pub const ERROR_INVALID_PRICE_BOUNDS: u32 = 14;
#[deprecated(note = "Use CoreError::MaxPauseDurationExceeded instead")]
pub const ERROR_MAX_PAUSE_DURATION_EXCEEDED: u32 = 15;
#[deprecated(note = "Use CoreError::RateLimited instead")]
pub const ERROR_RATE_LIMITED: u32 = 16;
#[deprecated(note = "Use CoreError::OracleUnavailable instead")]
pub const ERROR_ORACLE_UNAVAILABLE: u32 = 17;
#[deprecated(note = "Use CoreError::StorageVersionMismatch instead")]
pub const ERROR_STORAGE_VERSION_MISMATCH: u32 = 18;
#[deprecated(note = "Use CoreError::InvalidMigrationPath instead")]
pub const ERROR_INVALID_MIGRATION_PATH: u32 = 19;
#[deprecated(note = "Use CoreError::RefundExceedsTotalPaid instead")]
pub const ERROR_REFUND_EXCEEDS_TOTAL_PAID: u32 = 20;
#[deprecated(note = "Use CoreError::OwnerMismatch instead")]
pub const ERROR_PLAN_OWNER_MISMATCH: u32 = 21;
#[deprecated(note = "Use CoreError::EventNotFound instead")]
pub const ERROR_EVENT_NOT_FOUND: u32 = 22;
#[deprecated(note = "Use CoreError::EventStoreFull instead")]
pub const ERROR_EVENT_STORE_FULL: u32 = 23;
#[deprecated(note = "Use CoreError::InvalidEventSequence instead")]
pub const ERROR_INVALID_EVENT_SEQUENCE: u32 = 24;
#[deprecated(note = "Use CoreError::ExportWindowExceeded instead")]
pub const ERROR_EXPORT_WINDOW_EXCEEDED: u32 = 25;
#[deprecated(note = "Use CoreError::PaymentTimedOut instead")]
pub const ERROR_PAYMENT_TIMED_OUT: u32 = 26;
#[deprecated(note = "Use CoreError::RecoveryAttemptsExhausted instead")]
pub const ERROR_RECOVERY_ATTEMPTS_EXHAUSTED: u32 = 27;
#[deprecated(note = "Use CoreError::TransactionNotRecoverable instead")]
pub const ERROR_TRANSACTION_NOT_RECOVERABLE: u32 = 28;
#[deprecated(note = "Use CoreError::InvalidTimeoutConfig instead")]
pub const ERROR_INVALID_TIMEOUT_CONFIG: u32 = 29;
#[deprecated(note = "Use CoreError::ChainReorgDetected instead")]
pub const ERROR_CHAIN_REORG_DETECTED: u32 = 30;
