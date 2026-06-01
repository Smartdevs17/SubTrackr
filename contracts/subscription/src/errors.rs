//! Custom error types for the SubTrackr subscription contract — Issue #400.
//!
//! All contract entry-points return `Result<T, ContractError>` so callers
//! receive a typed, descriptive error rather than an opaque panic message.
//!
//! # Error code mapping (for API / frontend)
//!
//! The `#[repr(u32)]` discriminant is stable across upgrades.  **Do not
//! reorder or remove variants**; append new ones at the end to preserve
//! backward compatibility with deployed indexers.
//!
//! | Code | Variant                        | User-facing message                                    |
//! |------|--------------------------------|--------------------------------------------------------|
//! | 1    | Unauthorized                   | You are not authorised to perform this action.         |
//! | 2    | PlanNotFound                   | The requested plan does not exist.                     |
//! | 3    | PlanInactive                   | This plan is no longer accepting new subscribers.      |
//! | 4    | SubscriptionNotFound           | No active subscription found for this account.         |
//! | 5    | AlreadySubscribed              | You are already subscribed to this plan.               |
//! | 6    | SubscriptionNotActive          | This subscription is not currently active.             |
//! | 7    | SubscriptionAlreadyCancelled   | This subscription has already been cancelled.          |
//! | 8    | SubscriptionAlreadyPaused      | This subscription is already paused.                   |
//! | 9    | SubscriptionNotPaused          | This subscription is not paused.                       |
//! | 10   | PaymentNotYetDue               | The next payment is not due yet.                       |
//! | 11   | InsufficientAllowance          | Insufficient token allowance to process payment.       |
//! | 12   | InvalidAmount                  | Amount must be greater than zero.                      |
//! | 13   | InvalidInterval                | Billing interval must be positive.                     |
//! | 14   | InvalidPriceBounds             | Price bounds are invalid (max must be > min > 0).      |
//! | 15   | MaxPauseDurationExceeded       | Pause duration exceeds the allowed maximum of 30 days. |
//! | 16   | RateLimited                    | Too many requests. Please wait before retrying.        |
//! | 17   | OracleUnavailable              | Price oracle is temporarily unavailable.               |
//! | 18   | StorageVersionMismatch         | Storage schema version mismatch; run migration first.  |
//! | 19   | InvalidMigrationPath           | Unsupported migration path.                            |
//! | 20   | RefundExceedsTotalPaid         | Refund amount exceeds total amount paid.               |
//! | 21   | PlanOwnerMismatch              | Only the plan owner can perform this action.           |
//! | 22   | EventNotFound                  | The requested event does not exist.                    |
//! | 23   | EventStoreFull                 | Event store has reached maximum capacity.              |
//! | 24   | InvalidEventSequence           | Invalid event sequence for subscription state.         |
//! | 25   | ExportWindowExceeded           | Export range exceeds the maximum allowed window.       |
//! | 26   | PaymentTimedOut                | Payment transaction timed out waiting for confirmation.|
//! | 27   | RecoveryAttemptsExhausted      | All automatic recovery attempts have been exhausted.   |
//! | 28   | TransactionNotRecoverable      | Transaction is not in a recoverable state.             |
//! | 29   | InvalidTimeoutConfig           | Timeout configuration values are out of allowed range. |
//! | 30   | ChainReorgDetected             | Chain reorganisation detected during timeout window.   |
//! | 31   | SlippageExceeded               | Charge price exceeds configured slippage bounds.       |
//! | 32   | CommitmentExpired              | Commit-reveal deadline has passed.                     |
//! | 33   | CommitmentMismatch             | Revealed values do not match the commitment.           |
//! | 34   | MaxGasExceeded                 | Gas cost exceeds subscriber's configured maximum.      |
//! | 35   | PrivateMempoolRequired         | This charge requires a private mempool submission.     |

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Caller is not the admin or does not hold the required permission.
    Unauthorized = 1,
    /// The plan_id does not correspond to any stored plan.
    PlanNotFound = 2,
    /// The plan exists but has been deactivated.
    PlanInactive = 3,
    /// No subscription exists for the (subscriber, plan) pair.
    SubscriptionNotFound = 4,
    /// Subscriber already has an active subscription to this plan.
    AlreadySubscribed = 5,
    /// Operation requires an Active subscription but the current status differs.
    SubscriptionNotActive = 6,
    /// Attempted to cancel a subscription that is already Cancelled.
    SubscriptionAlreadyCancelled = 7,
    /// Attempted to pause a subscription that is already Paused.
    SubscriptionAlreadyPaused = 8,
    /// Attempted to resume a subscription that is not Paused.
    SubscriptionNotPaused = 9,
    /// `charge()` was called before `next_charge_at` was reached.
    PaymentNotYetDue = 10,
    /// The subscriber's token allowance is less than the required charge amount.
    InsufficientAllowance = 11,
    /// An amount parameter (price, refund, etc.) must be positive.
    InvalidAmount = 12,
    /// A billing interval must be positive (> 0 seconds).
    InvalidInterval = 13,
    /// PriceBounds are inconsistent (e.g. max_price_bps == 0).
    InvalidPriceBounds = 14,
    /// Pause duration exceeds `MAX_PAUSE_DURATION` (30 days).
    MaxPauseDurationExceeded = 15,
    /// Caller has been rate-limited; retry after the cooldown period.
    RateLimited = 16,
    /// The oracle contract returned an error or no price is available.
    OracleUnavailable = 17,
    /// Contract storage is at an unexpected version; migration required.
    StorageVersionMismatch = 18,
    /// The requested migration path (from_version → to_version) is not supported.
    InvalidMigrationPath = 19,
    /// Requested refund amount exceeds the subscription's `total_paid`.
    RefundExceedsTotalPaid = 20,
    /// Caller is not the merchant/owner of the plan being modified.
    PlanOwnerMismatch = 21,
    /// The requested event does not exist in the event store.
    EventNotFound = 22,
    /// Event store has reached maximum capacity for this subscription or merchant.
    EventStoreFull = 23,
    /// The event sequence is invalid for the current subscription state.
    InvalidEventSequence = 24,
    /// Export range exceeds the maximum allowed window.
    ExportWindowExceeded = 25,
    /// Payment transaction timed out waiting for on-chain confirmation.
    PaymentTimedOut = 26,
    /// All automatic recovery attempts have been exhausted.
    RecoveryAttemptsExhausted = 27,
    /// Transaction is not in a recoverable state (already resolved or abandoned).
    TransactionNotRecoverable = 28,
    /// Timeout configuration values are outside the allowed range.
    InvalidTimeoutConfig = 29,
    /// Chain reorganisation detected during the timeout window; recovery aborted.
    ChainReorgDetected = 30,
    /// Charge price exceeds configured slippage bounds.
    SlippageExceeded = 31,
    /// Commit-reveal deadline has passed.
    CommitmentExpired = 32,
    /// Revealed values do not match the commitment.
    CommitmentMismatch = 33,
    /// Gas cost exceeds subscriber's configured maximum.
    MaxGasExceeded = 34,
    /// This charge requires a private mempool submission.
    PrivateMempoolRequired = 35,
}

impl ContractError {
    /// Returns a short, user-facing English message for this error code.
    ///
    /// Frontends should display this message directly or map the `u32`
    /// discriminant to a localised string in their i18n bundle.
    pub fn user_message(self) -> &'static str {
        match self {
            Self::Unauthorized => "You are not authorised to perform this action.",
            Self::PlanNotFound => "The requested plan does not exist.",
            Self::PlanInactive => "This plan is no longer accepting new subscribers.",
            Self::SubscriptionNotFound => "No active subscription found for this account.",
            Self::AlreadySubscribed => "You are already subscribed to this plan.",
            Self::SubscriptionNotActive => "This subscription is not currently active.",
            Self::SubscriptionAlreadyCancelled => "This subscription has already been cancelled.",
            Self::SubscriptionAlreadyPaused => "This subscription is already paused.",
            Self::SubscriptionNotPaused => "This subscription is not paused.",
            Self::PaymentNotYetDue => "The next payment is not due yet.",
            Self::InsufficientAllowance => "Insufficient token allowance to process payment.",
            Self::InvalidAmount => "Amount must be greater than zero.",
            Self::InvalidInterval => "Billing interval must be positive.",
            Self::InvalidPriceBounds => "Price bounds are invalid (max must be > min > 0).",
            Self::MaxPauseDurationExceeded => {
                "Pause duration exceeds the allowed maximum of 30 days."
            }
            Self::RateLimited => "Too many requests. Please wait before retrying.",
            Self::OracleUnavailable => "Price oracle is temporarily unavailable.",
            Self::StorageVersionMismatch => "Storage schema version mismatch; run migration first.",
            Self::InvalidMigrationPath => "Unsupported migration path.",
            Self::RefundExceedsTotalPaid => "Refund amount exceeds total amount paid.",
            Self::PlanOwnerMismatch => "Only the plan owner can perform this action.",
            Self::EventNotFound => "The requested event does not exist.",
            Self::EventStoreFull => "Event store has reached maximum capacity.",
            Self::InvalidEventSequence => "Invalid event sequence for subscription state.",
            Self::ExportWindowExceeded => "Export range exceeds the maximum allowed window.",
            Self::PaymentTimedOut => "Payment transaction timed out waiting for confirmation.",
            Self::RecoveryAttemptsExhausted => {
                "All automatic recovery attempts have been exhausted."
            }
            Self::TransactionNotRecoverable => "Transaction is not in a recoverable state.",
            Self::InvalidTimeoutConfig => "Timeout configuration values are out of allowed range.",
            Self::ChainReorgDetected => "Chain reorganisation detected during timeout window.",
            Self::SlippageExceeded => "Charge price exceeds configured slippage bounds.",
            Self::CommitmentExpired => "Commit-reveal deadline has passed.",
            Self::CommitmentMismatch => "Revealed values do not match the commitment.",
            Self::MaxGasExceeded => "Gas cost exceeds subscriber's configured maximum.",
            Self::PrivateMempoolRequired => "This charge requires a private mempool submission.",
        }
    }

    /// Returns the stable `u32` error code used in API responses.
    pub fn error_code(self) -> u32 {
        self as u32
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::ContractError;

    /// Error codes must be stable — verify that discriminant values are correct.
    #[test]
    fn error_codes_are_stable() {
        assert_eq!(ContractError::Unauthorized as u32, 1);
        assert_eq!(ContractError::PlanNotFound as u32, 2);
        assert_eq!(ContractError::AlreadySubscribed as u32, 5);
        assert_eq!(ContractError::PaymentNotYetDue as u32, 10);
        assert_eq!(ContractError::RefundExceedsTotalPaid as u32, 20);
        assert_eq!(ContractError::PlanOwnerMismatch as u32, 21);
        assert_eq!(ContractError::EventNotFound as u32, 22);
        assert_eq!(ContractError::EventStoreFull as u32, 23);
        assert_eq!(ContractError::InvalidEventSequence as u32, 24);
        assert_eq!(ContractError::ExportWindowExceeded as u32, 25);
        assert_eq!(ContractError::PaymentTimedOut as u32, 26);
        assert_eq!(ContractError::RecoveryAttemptsExhausted as u32, 27);
        assert_eq!(ContractError::TransactionNotRecoverable as u32, 28);
        assert_eq!(ContractError::InvalidTimeoutConfig as u32, 29);
        assert_eq!(ContractError::ChainReorgDetected as u32, 30);
        assert_eq!(ContractError::SlippageExceeded as u32, 31);
        assert_eq!(ContractError::CommitmentExpired as u32, 32);
        assert_eq!(ContractError::CommitmentMismatch as u32, 33);
        assert_eq!(ContractError::MaxGasExceeded as u32, 34);
        assert_eq!(ContractError::PrivateMempoolRequired as u32, 35);
    }

    /// Every variant must have a non-empty user_message.
    #[test]
    fn all_variants_have_user_messages() {
        use ContractError::*;
        let variants = [
            Unauthorized,
            PlanNotFound,
            PlanInactive,
            SubscriptionNotFound,
            AlreadySubscribed,
            SubscriptionNotActive,
            SubscriptionAlreadyCancelled,
            SubscriptionAlreadyPaused,
            SubscriptionNotPaused,
            PaymentNotYetDue,
            InsufficientAllowance,
            InvalidAmount,
            InvalidInterval,
            InvalidPriceBounds,
            MaxPauseDurationExceeded,
            RateLimited,
            OracleUnavailable,
            StorageVersionMismatch,
            InvalidMigrationPath,
            RefundExceedsTotalPaid,
            ExportWindowExceeded,
            PaymentTimedOut,
            RecoveryAttemptsExhausted,
            TransactionNotRecoverable,
            InvalidTimeoutConfig,
            ChainReorgDetected,
            SlippageExceeded,
            CommitmentExpired,
            CommitmentMismatch,
            MaxGasExceeded,
            PrivateMempoolRequired,
        ];
        for v in variants {
            let msg = v.user_message();
            assert!(!msg.is_empty(), "Empty message for {:?}", v);
            assert!(msg.len() < 120, "Message too long for {:?}: {}", v, msg);
        }
    }

    /// error_code() must equal the #[repr(u32)] discriminant.
    #[test]
    fn error_code_matches_discriminant() {
        assert_eq!(ContractError::Unauthorized.error_code(), 1);
        assert_eq!(ContractError::OracleUnavailable.error_code(), 17);
    }
}
