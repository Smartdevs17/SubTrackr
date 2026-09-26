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
    /// How billable units are rated once the included tier is consumed.
    pub pricing_model: PricingModel,
    /// Price ladder used by every model except [`PricingModel::Flat`].
    pub tiers: Vec<PriceTier>,
    pub buckets: Vec<UsageBucket>,
}

/// A billable line for one metric within a charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeLine {
    pub metric: Symbol,
    pub units: u64,
    /// Units left after the included (free) allowance — i.e. the overage.
    pub billable_units: u64,
    pub unit_price: i128,
    pub amount: i128,
    /// Per-tier split of `amount`; a single entry under flat pricing.
    pub tier_lines: Vec<TierLine>,
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

/// How billable units are converted into an amount once the included (free)
/// tier has been consumed.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PricingModel {
    /// Every billable unit costs `MeterState::unit_price`.
    Flat,
    /// Units are split across `MeterState::tiers`; each slice is priced at the
    /// rate of the tier it falls into (a.k.a. graduated pricing).
    Graduated,
    /// All billable units are priced at the rate of the single tier that the
    /// total lands in.
    Volume,
    /// Units are sold in whole blocks: each started block of
    /// `PriceTier::up_to_units` units costs `PriceTier::flat_fee`.
    Package,
}

/// One band of a tiered price ladder.
///
/// `up_to_units` is the inclusive upper bound of the band expressed as a
/// cumulative unit count; `0` means "unbounded" and may only appear on the
/// last tier. `flat_fee` is charged once when any unit falls into the band
/// (and is the per-block price under [`PricingModel::Package`]).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceTier {
    pub up_to_units: u64,
    pub unit_price: i128,
    pub flat_fee: i128,
}

/// The share of a charge attributable to one tier of the ladder.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TierLine {
    pub up_to_units: u64,
    pub units: u64,
    pub unit_price: i128,
    pub amount: i128,
}

/// Rates the billable units of one meter, returning the total amount and the
/// per-tier breakdown. Pure: no storage or ledger access.
///
/// `tiers` are assumed to be in ascending `up_to_units` order, which
/// [`validate_tiers`] enforces at registration time.
pub fn rate_units(
    env: &soroban_sdk::Env,
    model: &PricingModel,
    billable: u64,
    unit_price: i128,
    tiers: &Vec<PriceTier>,
) -> (i128, Vec<TierLine>) {
    let mut lines: Vec<TierLine> = Vec::new(env);

    if billable == 0 {
        return (0, lines);
    }

    match model {
        PricingModel::Flat => {
            let amount = (billable as i128).saturating_mul(unit_price);
            lines.push_back(TierLine {
                up_to_units: 0,
                units: billable,
                unit_price,
                amount,
            });
            (amount, lines)
        }
        PricingModel::Graduated => {
            let mut total: i128 = 0;
            let mut remaining = billable;
            let mut lower: u64 = 0;
            let mut i = 0u32;
            while i < tiers.len() && remaining > 0 {
                let tier = tiers.get(i).unwrap();
                let capacity = if tier.up_to_units == 0 {
                    remaining
                } else {
                    tier.up_to_units.saturating_sub(lower)
                };
                let units = if remaining < capacity {
                    remaining
                } else {
                    capacity
                };
                if units > 0 {
                    let amount = (units as i128)
                        .saturating_mul(tier.unit_price)
                        .saturating_add(tier.flat_fee);
                    total = total.saturating_add(amount);
                    lines.push_back(TierLine {
                        up_to_units: tier.up_to_units,
                        units,
                        unit_price: tier.unit_price,
                        amount,
                    });
                    remaining -= units;
                }
                if tier.up_to_units == 0 {
                    break;
                }
                lower = tier.up_to_units;
                i += 1;
            }
            // Units beyond the last bounded tier fall back to the flat rate so
            // a truncated ladder never silently bills zero.
            if remaining > 0 {
                let amount = (remaining as i128).saturating_mul(unit_price);
                total = total.saturating_add(amount);
                lines.push_back(TierLine {
                    up_to_units: 0,
                    units: remaining,
                    unit_price,
                    amount,
                });
            }
            (total, lines)
        }
        PricingModel::Volume => {
            let tier = select_tier(tiers, billable);
            let (price, bound, fee) = match tier {
                Some(t) => (t.unit_price, t.up_to_units, t.flat_fee),
                None => (unit_price, 0, 0),
            };
            let amount = (billable as i128).saturating_mul(price).saturating_add(fee);
            lines.push_back(TierLine {
                up_to_units: bound,
                units: billable,
                unit_price: price,
                amount,
            });
            (amount, lines)
        }
        PricingModel::Package => {
            let tier = select_tier(tiers, billable);
            let (block, fee, bound) = match tier {
                Some(t) => (t.up_to_units, t.flat_fee, t.up_to_units),
                None => (0, 0, 0),
            };
            if block == 0 {
                // No usable package size; fall back to flat rating.
                let amount = (billable as i128).saturating_mul(unit_price);
                lines.push_back(TierLine {
                    up_to_units: 0,
                    units: billable,
                    unit_price,
                    amount,
                });
                return (amount, lines);
            }
            let blocks = billable.div_ceil(block);
            let amount = (blocks as i128).saturating_mul(fee);
            lines.push_back(TierLine {
                up_to_units: bound,
                units: billable,
                unit_price: fee,
                amount,
            });
            (amount, lines)
        }
    }
}

/// Returns the first tier whose bound covers `units`, or the unbounded tier.
fn select_tier(tiers: &Vec<PriceTier>, units: u64) -> Option<PriceTier> {
    let mut i = 0u32;
    while i < tiers.len() {
        let tier = tiers.get(i).unwrap();
        if tier.up_to_units == 0 || units <= tier.up_to_units {
            return Some(tier);
        }
        i += 1;
    }
    // Past the end of a bounded ladder: bill at the last tier's rate.
    if !tiers.is_empty() {
        return tiers.get(tiers.len() - 1);
    }
    None
}

/// True when `tiers` form a usable ladder: ascending bounds, no negative
/// prices, and an unbounded (`0`) bound only in final position.
pub fn validate_tiers(tiers: &Vec<PriceTier>) -> bool {
    let mut previous: u64 = 0;
    let mut i = 0u32;
    while i < tiers.len() {
        let tier = tiers.get(i).unwrap();
        if tier.unit_price < 0 || tier.flat_fee < 0 {
            return false;
        }
        if tier.up_to_units == 0 {
            // Unbounded tier must be last.
            return i == tiers.len() - 1;
        }
        if tier.up_to_units <= previous {
            return false;
        }
        previous = tier.up_to_units;
        i += 1;
    }
    true
}
