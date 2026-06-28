//! Metering value types and pure (storage-free) helpers.

use soroban_sdk::{contracttype, Symbol, Vec};
use subtrackr_types::SubscriptionId;

/// A meter is identified by its metric symbol (e.g. `api_calls`, `gb_egress`).
pub type Meter = Symbol;

/// A single usage observation. `value` is the increment recorded for `metric`
/// at `timestamp` (the ledger time of ingestion).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MeteredUsage {
    pub metric: Symbol,
    pub value: u64,
    pub timestamp: u64,
}

/// Period-aggregated usage; `start` is the bucket's period start (seconds).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UsageBucket {
    pub start: u64,
    pub units: u64,
}

/// Per `(subscription, metric)` meter configuration and running state.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MeterState {
    pub metric: Symbol,
    /// Cumulative units recorded over the meter's lifetime.
    pub total: u64,
    /// Ledger time of the most recent ingestion.
    pub last_timestamp: u64,
    /// Aggregation period length in seconds for [`UsageBucket`]s.
    pub period_secs: u64,
    /// Units included for free when computing charges.
    pub included_units: u64,
    /// Price per billable unit, scaled like other monetary values.
    pub unit_price: i128,
    /// Cumulative-total threshold that fires a usage alert (0 disables).
    pub alert_threshold: u64,
    /// Whether the alert for the current threshold has already fired.
    pub alert_fired: bool,
    pub buckets: Vec<UsageBucket>,
}

/// A billable line for one metric within a charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeLine {
    pub metric: Symbol,
    pub units: u64,
    pub billable_units: u64,
    pub unit_price: i128,
    pub amount: i128,
}

/// The result of [`calculate_usage_charge`](crate::SubTrackrMetering::calculate_usage_charge).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Charge {
    pub subscription_id: SubscriptionId,
    pub currency: Symbol,
    pub total: i128,
    pub lines: Vec<ChargeLine>,
}

/// Returns the bucket start for `now` given a period length.
pub fn bucket_start(now: u64, period_secs: u64) -> u64 {
    if period_secs == 0 {
        now
    } else {
        now - (now % period_secs)
    }
}

/// Billable units after subtracting the included free tier.
pub fn billable_units(used: u64, included: u64) -> u64 {
    used.saturating_sub(included)
}
