//! Price representation and the pure pricing logic used by the oracle contract.
//!
//! This module deliberately keeps the math (deviation, staleness, aggregation)
//! free of storage access so it can be unit-tested and reused by the fallback
//! and circuit-breaker code paths in [`crate`].

use soroban_sdk::{contracttype, Address, Symbol};

/// Which feed produced a quote. Used to tell primary and fallback prices apart
/// in events and history.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PriceSource {
    Primary,
    Fallback,
}

/// A single price observation for a `(token, quote)` pair.
///
/// `value` is an integer scaled by `10^decimals`; e.g. a XLM/USD price of
/// `0.1234` with `decimals = 7` is stored as `1_234_000`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Price {
    /// Base asset, e.g. `XLM`.
    pub token: Symbol,
    /// Quote currency, e.g. `USD`.
    pub quote: Symbol,
    /// Price scaled by `10^decimals`.
    pub value: i128,
    /// Number of fractional decimals encoded in `value`.
    pub decimals: u32,
    /// Ledger timestamp (seconds) the observation was produced.
    pub timestamp: u64,
    /// Feed that produced the observation.
    pub source: PriceSource,
}

/// Per `(token, quote)` feed configuration.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FeedConfig {
    pub token: Symbol,
    pub quote: Symbol,
    /// Authorized address allowed to push the primary price.
    pub primary: Address,
    /// Optional authorized address for the redundant/fallback price.
    pub fallback: Option<Address>,
    /// Observations older than this many seconds are considered stale.
    pub max_staleness_secs: u64,
    /// Inter-update deviation (basis points) above which an alert/breaker fires.
    pub deviation_threshold_bps: u32,
    /// Decimals all observations for this pair are scaled by.
    pub decimals: u32,
}

/// Circuit-breaker state for a feed. The breaker trips when consecutive
/// faults (stale or wildly deviating updates) exceed a threshold and stays
/// tripped until it is manually reset or the cooldown elapses.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CircuitState {
    pub tripped: bool,
    pub consecutive_faults: u32,
    pub tripped_at: u64,
}

impl CircuitState {
    pub fn closed() -> Self {
        CircuitState {
            tripped: false,
            consecutive_faults: 0,
            tripped_at: 0,
        }
    }
}

/// Returns `true` when `observed_at` is older than `max_staleness_secs`
/// relative to `now`. A future-dated observation is never considered stale.
pub fn is_stale(now: u64, observed_at: u64, max_staleness_secs: u64) -> bool {
    now.saturating_sub(observed_at) > max_staleness_secs
}

/// Absolute deviation between `previous` and `current` expressed in basis
/// points of `previous`. Returns `0` when there is no meaningful previous
/// price to compare against.
pub fn deviation_bps(previous: i128, current: i128) -> u32 {
    if previous == 0 {
        return 0;
    }
    let diff = (current - previous).unsigned_abs();
    let base = previous.unsigned_abs();
    // diff * 10_000 / base, saturating into u32 for alerting purposes.
    let bps = diff.saturating_mul(10_000) / base;
    if bps > u32::MAX as u128 {
        u32::MAX
    } else {
        bps as u32
    }
}

/// Chooses the freshest non-stale price between an optional primary and
/// fallback observation. Prefers the primary when both are valid.
pub fn select_price(
    now: u64,
    max_staleness_secs: u64,
    primary: Option<Price>,
    fallback: Option<Price>,
) -> Option<Price> {
    let primary_ok = primary
        .as_ref()
        .filter(|p| !is_stale(now, p.timestamp, max_staleness_secs))
        .cloned();
    if primary_ok.is_some() {
        return primary_ok;
    }
    fallback
        .as_ref()
        .filter(|p| !is_stale(now, p.timestamp, max_staleness_secs))
        .cloned()
}
