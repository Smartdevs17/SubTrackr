/// Revenue recognition module for SubTrackr subscriptions.
///
/// Implements ASC 606 / IFRS 15 compliant revenue recognition:
///   - Straight-line: revenue spread evenly across the billing period.
///   - Usage-based: revenue deferred until actual usage is reported.
///
/// All storage is delegated to the shared storage contract via the
/// `storage_persistent_*` helpers defined in the parent module.
use soroban_sdk::{contracttype, Address, Env, Vec};
use subtrackr_types::StorageKey;

use crate::{storage_persistent_get, storage_persistent_set};

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RecognitionMethod {
    StraightLine,
    UsageBased,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RevenueRecognitionRule {
    pub plan_id: u64,
    pub method: RecognitionMethod,
    /// Length of one recognition period in seconds.
    pub recognition_period: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RevenueScheduleEntry {
    pub period_start: u64,
    pub period_end: u64,
    pub recognised_amount: i128,
    pub is_recognised: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RevenueSchedule {
    pub subscription_id: u64,
    pub total_amount: i128,
    pub entries: Vec<RevenueScheduleEntry>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Recognition {
    pub subscription_id: u64,
    pub merchant: Address,
    pub recognised_revenue: i128,
    pub deferred_revenue: i128,
    pub as_of: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PeriodRevenue {
    pub period_start: u64,
    pub period_end: u64,
    pub recognised_amount: i128,
    pub subscription_count: u32,
}

// ── Pure schedule builders ────────────────────────────────────────────────────

pub fn build_straight_line_schedule(
    env: &Env,
    subscription_id: u64,
    total_amount: i128,
    charge_time: u64,
    period_secs: u64,
    num_periods: u32,
) -> RevenueSchedule {
    assert!(num_periods > 0, "num_periods must be > 0");
    assert!(period_secs > 0, "period_secs must be > 0");
    assert!(total_amount >= 0, "total_amount must be non-negative");

    let slice = total_amount / num_periods as i128;
    let remainder = total_amount - slice * num_periods as i128;

    let mut entries: Vec<RevenueScheduleEntry> = Vec::new(env);
    for i in 0..num_periods {
        let start = charge_time + (i as u64) * period_secs;
        let end = start + period_secs;
        let amount = if i == num_periods - 1 {
            slice + remainder
        } else {
            slice
        };
        entries.push_back(RevenueScheduleEntry {
            period_start: start,
            period_end: end,
            recognised_amount: amount,
            is_recognised: false,
        });
    }
    RevenueSchedule {
        subscription_id,
        total_amount,
        entries,
    }
}

pub fn build_usage_based_schedule(
    env: &Env,
    subscription_id: u64,
    total_amount: i128,
    charge_time: u64,
    interval_secs: u64,
) -> RevenueSchedule {
    let mut entries: Vec<RevenueScheduleEntry> = Vec::new(env);
    entries.push_back(RevenueScheduleEntry {
        period_start: charge_time,
        period_end: charge_time + interval_secs,
        recognised_amount: total_amount,
        is_recognised: false,
    });
    RevenueSchedule {
        subscription_id,
        total_amount,
        entries,
    }
}

/// Pro-rate a schedule as of `now` → (recognised, deferred).
pub fn split_recognised_deferred(schedule: &RevenueSchedule, now: u64) -> (i128, i128) {
    let mut recognised: i128 = 0;
    let mut deferred: i128 = 0;
    for entry in schedule.entries.iter() {
        if now >= entry.period_end {
            recognised += entry.recognised_amount;
        } else if now >= entry.period_start {
            let elapsed = now - entry.period_start;
            let duration = entry.period_end - entry.period_start;
            let partial = entry.recognised_amount * elapsed as i128 / duration as i128;
            recognised += partial;
            deferred += entry.recognised_amount - partial;
        } else {
            deferred += entry.recognised_amount;
        }
    }
    (recognised, deferred)
}

// ── Storage helpers ───────────────────────────────────────────────────────────

pub fn set_recognition_rule(env: &Env, storage: &Address, rule: RevenueRecognitionRule) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::RevenueRecognitionRule(rule.plan_id),
        rule,
    );
}

pub fn get_recognition_rule(
    env: &Env,
    storage: &Address,
    plan_id: u64,
) -> Option<RevenueRecognitionRule> {
    storage_persistent_get(env, storage, StorageKey::RevenueRecognitionRule(plan_id))
}

pub fn get_revenue_schedule(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
) -> Option<RevenueSchedule> {
    storage_persistent_get(env, storage, StorageKey::RevenueSchedule(subscription_id))
}

pub fn get_deferred_revenue(env: &Env, storage: &Address, merchant: &Address) -> i128 {
    storage_persistent_get(
        env,
        storage,
        StorageKey::RevenueDeferredBalance(merchant.clone()),
    )
    .unwrap_or(0i128)
}

/// Generate and persist a revenue schedule for a charge.
pub fn generate_revenue_schedule(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    plan_id: u64,
    total_amount: i128,
    charge_time: u64,
    interval_secs: u64,
) -> RevenueSchedule {
    let rule = get_recognition_rule(env, storage, plan_id);

    let schedule = match rule {
        Some(r) => {
            let num_periods = if r.recognition_period > 0 {
                interval_secs.div_ceil(r.recognition_period) as u32
            } else {
                1
            };
            match r.method {
                RecognitionMethod::StraightLine => build_straight_line_schedule(
                    env,
                    subscription_id,
                    total_amount,
                    charge_time,
                    r.recognition_period,
                    num_periods,
                ),
                RecognitionMethod::UsageBased => build_usage_based_schedule(
                    env,
                    subscription_id,
                    total_amount,
                    charge_time,
                    interval_secs,
                ),
            }
        }
        None => build_straight_line_schedule(
            env,
            subscription_id,
            total_amount,
            charge_time,
            interval_secs,
            1,
        ),
    };

    storage_persistent_set(
        env,
        storage,
        StorageKey::RevenueSchedule(subscription_id),
        schedule.clone(),
    );
    schedule
}

/// Compute a Recognition snapshot as of `now`.
pub fn recognize_revenue(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    merchant: Address,
    now: u64,
) -> Recognition {
    match get_revenue_schedule(env, storage, subscription_id) {
        None => Recognition {
            subscription_id,
            merchant,
            recognised_revenue: 0,
            deferred_revenue: 0,
            as_of: now,
        },
        Some(schedule) => {
            let (recognised, deferred) = split_recognised_deferred(&schedule, now);
            Recognition {
                subscription_id,
                merchant,
                recognised_revenue: recognised,
                deferred_revenue: deferred,
                as_of: now,
            }
        }
    }
}

/// Update merchant cumulative balances after a charge (all revenue starts deferred).
pub fn update_merchant_revenue_balances(
    env: &Env,
    storage: &Address,
    merchant: &Address,
    recognised_delta: i128,
    deferred_delta: i128,
) {
    let prev_rec: i128 = storage_persistent_get(
        env,
        storage,
        StorageKey::RevenueRecognisedBalance(merchant.clone()),
    )
    .unwrap_or(0i128);
    let prev_def: i128 = storage_persistent_get(
        env,
        storage,
        StorageKey::RevenueDeferredBalance(merchant.clone()),
    )
    .unwrap_or(0i128);

    storage_persistent_set(
        env,
        storage,
        StorageKey::RevenueRecognisedBalance(merchant.clone()),
        prev_rec + recognised_delta,
    );
    storage_persistent_set(
        env,
        storage,
        StorageKey::RevenueDeferredBalance(merchant.clone()),
        prev_def + deferred_delta,
    );
}

/// Register a subscription under a merchant for analytics (deduplicates).
pub fn track_merchant_subscription(
    env: &Env,
    storage: &Address,
    merchant: &Address,
    subscription_id: u64,
) {
    let mut ids: Vec<u64> = storage_persistent_get(
        env,
        storage,
        StorageKey::RevenueMerchantSubscriptions(merchant.clone()),
    )
    .unwrap_or(Vec::new(env));
    for existing in ids.iter() {
        if existing == subscription_id {
            return;
        }
    }
    ids.push_back(subscription_id);
    storage_persistent_set(
        env,
        storage,
        StorageKey::RevenueMerchantSubscriptions(merchant.clone()),
        ids,
    );
}

/// Compute per-period revenue analytics for a merchant.
pub fn get_revenue_analytics_by_period(
    env: &Env,
    storage: &Address,
    merchant: &Address,
    period_secs: u64,
    from: u64,
    to: u64,
) -> Vec<PeriodRevenue> {
    assert!(period_secs > 0, "period_secs must be > 0");
    assert!(to >= from, "to must be >= from");

    let sub_ids: Vec<u64> = storage_persistent_get(
        env,
        storage,
        StorageKey::RevenueMerchantSubscriptions(merchant.clone()),
    )
    .unwrap_or(Vec::new(env));

    let num_buckets = (to - from).div_ceil(period_secs) as u32;
    let mut buckets: Vec<PeriodRevenue> = Vec::new(env);
    for i in 0..num_buckets {
        let start = from + (i as u64) * period_secs;
        buckets.push_back(PeriodRevenue {
            period_start: start,
            period_end: start + period_secs,
            recognised_amount: 0,
            subscription_count: 0,
        });
    }

    for sub_id in sub_ids.iter() {
        let maybe: Option<RevenueSchedule> =
            storage_persistent_get(env, storage, StorageKey::RevenueSchedule(sub_id));
        if let Some(schedule) = maybe {
            let mut contributed = false;
            for entry in schedule.entries.iter() {
                if entry.period_start < from || entry.period_start >= to {
                    continue;
                }
                let idx = ((entry.period_start - from) / period_secs) as u32;
                if idx < num_buckets {
                    let mut bucket = buckets.get_unchecked(idx);
                    bucket.recognised_amount += entry.recognised_amount;
                    if !contributed {
                        bucket.subscription_count += 1;
                        contributed = true;
                    }
                    buckets.set(idx, bucket);
                }
            }
        }
    }

    buckets
}
