#![no_std]
//! SubTrackr usage-metering contract.
//!
//! Real-time usage-based billing (issue: metered billing). Reporters push
//! `MeteredUsage` increments per `(subscription, metric)`; the contract
//! aggregates them into period buckets so high-frequency ingestion stays
//! bounded, fires alerts on configurable thresholds, and computes usage charges
//! over an arbitrary time range.
//!
//! Features:
//! * `MeteredUsage { metric, value, timestamp }` ingestion
//! * usage aggregation by period (configurable bucket length)
//! * real-time billing via [`SubTrackrMetering::calculate_usage_charge`]
//! * multiple meters per subscription
//! * usage alerts and full history/trend access
//!
//! Timestamps come from the ledger (not the caller) to keep aggregation
//! consistent under concurrent, high-frequency ingestion.

mod metering;
#[cfg(test)]
mod test;

pub use metering::{
    billable_units, bucket_start, Charge, ChargeLine, Meter, MeterState, MeteredUsage, UsageBucket,
};

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};
use subtrackr_types::{SubscriptionId, TimeRange};

/// Default aggregation period (one day) when a meter is auto-registered.
const DEFAULT_PERIOD_SECS: u64 = 86_400;
/// Maximum number of retained period buckets per meter (~one quarter of days).
const MAX_BUCKETS: u32 = 90;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum MeteringError {
    InvalidValue = 1,
    InvalidPeriod = 2,
    MeterNotFound = 3,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Meters(SubscriptionId),
    Meter(SubscriptionId, Symbol),
}

#[contract]
pub struct SubTrackrMetering;

#[contractimpl]
impl SubTrackrMetering {
    /// Registers or reconfigures a meter, setting its pricing, included tier,
    /// aggregation period, and alert threshold. Existing totals/buckets are
    /// preserved across reconfiguration.
    pub fn register_meter(
        env: Env,
        reporter: Address,
        subscription_id: SubscriptionId,
        meter: Meter,
        unit_price: i128,
        included_units: u64,
        period_secs: u64,
        alert_threshold: u64,
    ) -> Result<(), MeteringError> {
        reporter.require_auth();
        if period_secs == 0 {
            return Err(MeteringError::InvalidPeriod);
        }
        let mut state = Self::meter(&env, subscription_id, &meter).unwrap_or(MeterState {
            metric: meter.clone(),
            total: 0,
            last_timestamp: 0,
            period_secs,
            included_units,
            unit_price,
            alert_threshold,
            alert_fired: false,
            buckets: Vec::new(&env),
        });
        state.period_secs = period_secs;
        state.included_units = included_units;
        state.unit_price = unit_price;
        // Re-arming the alert lets a raised threshold fire again.
        state.alert_threshold = alert_threshold;
        state.alert_fired = state.total >= alert_threshold && alert_threshold != 0;
        Self::save_meter(&env, subscription_id, &state);
        Self::track_metric(&env, subscription_id, &meter);
        Ok(())
    }

    /// Records a usage increment for a meter. Auto-registers an unpriced meter
    /// on first use so ingestion never fails for a new metric.
    pub fn record_metered_usage(
        env: Env,
        reporter: Address,
        subscription_id: SubscriptionId,
        meter: Meter,
        value: u64,
    ) -> Result<MeteredUsage, MeteringError> {
        reporter.require_auth();
        if value == 0 {
            return Err(MeteringError::InvalidValue);
        }
        let now = env.ledger().timestamp();
        let mut state = Self::meter(&env, subscription_id, &meter).unwrap_or(MeterState {
            metric: meter.clone(),
            total: 0,
            last_timestamp: 0,
            period_secs: DEFAULT_PERIOD_SECS,
            included_units: 0,
            unit_price: 0,
            alert_threshold: 0,
            alert_fired: false,
            buckets: Vec::new(&env),
        });

        state.total = state.total.saturating_add(value);
        state.last_timestamp = now;
        Self::add_to_bucket(&mut state, now, value);

        if state.alert_threshold != 0 && !state.alert_fired && state.total >= state.alert_threshold
        {
            state.alert_fired = true;
            env.events().publish(
                (symbol_short!("usage_alt"), subscription_id, meter.clone()),
                (state.total, state.alert_threshold),
            );
        }

        Self::save_meter(&env, subscription_id, &state);
        Self::track_metric(&env, subscription_id, &meter);

        let observation = MeteredUsage {
            metric: meter,
            value,
            timestamp: now,
        };
        env.events().publish(
            (symbol_short!("usage"), subscription_id),
            observation.clone(),
        );
        Ok(observation)
    }

    /// Computes the usage charge for a subscription over `period`, summing
    /// bucketed usage per metric and applying each meter's free tier and price.
    pub fn calculate_usage_charge(
        env: Env,
        subscription_id: SubscriptionId,
        period: TimeRange,
    ) -> Result<Charge, MeteringError> {
        if period.end < period.start {
            return Err(MeteringError::InvalidPeriod);
        }
        let metrics = Self::metrics(&env, subscription_id);
        let mut lines: Vec<ChargeLine> = Vec::new(&env);
        let mut total: i128 = 0;

        let mut m = 0u32;
        while m < metrics.len() {
            let metric = metrics.get(m).unwrap();
            if let Some(state) = Self::meter(&env, subscription_id, &metric) {
                let used = Self::usage_in_range(&state, &period);
                let billable = billable_units(used, state.included_units);
                let amount = (billable as i128).saturating_mul(state.unit_price);
                total = total.saturating_add(amount);
                lines.push_back(ChargeLine {
                    metric,
                    units: used,
                    billable_units: billable,
                    unit_price: state.unit_price,
                    amount,
                });
            }
            m += 1;
        }

        Ok(Charge {
            subscription_id,
            currency: Symbol::new(&env, "USD"),
            total,
            lines,
        })
    }

    /// Lists the metrics registered for a subscription.
    pub fn get_meters(env: Env, subscription_id: SubscriptionId) -> Vec<Symbol> {
        Self::metrics(&env, subscription_id)
    }

    /// Returns a meter's full state (config, total, and bucket history/trends).
    pub fn get_meter(
        env: Env,
        subscription_id: SubscriptionId,
        meter: Meter,
    ) -> Result<MeterState, MeteringError> {
        Self::meter(&env, subscription_id, &meter).ok_or(MeteringError::MeterNotFound)
    }

    /// Cumulative units recorded for a meter.
    pub fn get_usage_total(env: Env, subscription_id: SubscriptionId, meter: Meter) -> u64 {
        Self::meter(&env, subscription_id, &meter)
            .map(|s| s.total)
            .unwrap_or(0)
    }

    // ---- internals --------------------------------------------------------

    fn add_to_bucket(state: &mut MeterState, now: u64, value: u64) {
        let start = bucket_start(now, state.period_secs);
        let len = state.buckets.len();
        if len > 0 {
            let last = state.buckets.get(len - 1).unwrap();
            if last.start == start {
                state.buckets.set(
                    len - 1,
                    UsageBucket {
                        start,
                        units: last.units.saturating_add(value),
                    },
                );
                return;
            }
        }
        state.buckets.push_back(UsageBucket {
            start,
            units: value,
        });
        while state.buckets.len() > MAX_BUCKETS {
            state.buckets.remove(0);
        }
    }

    fn usage_in_range(state: &MeterState, period: &TimeRange) -> u64 {
        let mut used: u64 = 0;
        let mut i = 0u32;
        while i < state.buckets.len() {
            let b = state.buckets.get(i).unwrap();
            if b.start >= period.start && b.start <= period.end {
                used = used.saturating_add(b.units);
            }
            i += 1;
        }
        used
    }

    fn meter(env: &Env, sub: SubscriptionId, metric: &Symbol) -> Option<MeterState> {
        env.storage()
            .persistent()
            .get(&DataKey::Meter(sub, metric.clone()))
    }

    fn save_meter(env: &Env, sub: SubscriptionId, state: &MeterState) {
        env.storage()
            .persistent()
            .set(&DataKey::Meter(sub, state.metric.clone()), state);
    }

    fn metrics(env: &Env, sub: SubscriptionId) -> Vec<Symbol> {
        env.storage()
            .persistent()
            .get(&DataKey::Meters(sub))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn track_metric(env: &Env, sub: SubscriptionId, metric: &Symbol) {
        let mut metrics = Self::metrics(env, sub);
        let mut i = 0u32;
        while i < metrics.len() {
            if metrics.get(i).unwrap() == *metric {
                return;
            }
            i += 1;
        }
        metrics.push_back(metric.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Meters(sub), &metrics);
    }
}
