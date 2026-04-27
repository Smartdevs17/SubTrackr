use crate::{quota, storage_persistent_get, storage_persistent_set};
use soroban_sdk::{Address, Env};
use subtrackr_types::{Quota, QuotaMetric, QuotaStatus, RolloverPolicy, StorageKey, UsageRecord};

pub fn record_usage(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    plan_id: u64,
    metric: QuotaMetric,
    amount: u64,
) -> UsageRecord {
    let now = env.ledger().timestamp();
    let quotas = quota::get_plan_quotas(env, storage, plan_id);

    let maybe_quota = quotas.iter().find(|q| q.metric == metric);
    let quota = maybe_quota.expect("Metric not found for this plan");

    let mut record = get_usage_record(env, storage, subscription_id, metric.clone());

    // Check if period has expired
    if now >= record.period_start + quota.period.seconds() {
        // Calculate rollover
        let unused = if record.current_usage < (quota.limit + record.rollover_balance) {
            (quota.limit + record.rollover_balance) - record.current_usage
        } else {
            0
        };

        let new_rollover = match quota.rollover_policy {
            RolloverPolicy::NoRollover => 0,
            RolloverPolicy::RolloverAll => unused,
            RolloverPolicy::RolloverCap(cap) => {
                if unused > cap {
                    cap
                } else {
                    unused
                }
            }
        };

        record.period_start = now;
        record.current_usage = 0;
        record.rollover_balance = new_rollover;
    }

    record.current_usage += amount;

    storage_persistent_set(
        env,
        storage,
        StorageKey::SubscriptionUsage(subscription_id, metric),
        record.clone(),
    );

    record
}

pub fn get_usage_record(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    metric: QuotaMetric,
) -> UsageRecord {
    storage_persistent_get(
        env,
        storage,
        StorageKey::SubscriptionUsage(subscription_id, metric.clone()),
    )
    .unwrap_or(UsageRecord {
        subscription_id,
        metric,
        current_usage: 0,
        period_start: env.ledger().timestamp(),
        rollover_balance: 0,
    })
}

pub fn check_quota(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    plan_id: u64,
    metric: QuotaMetric,
) -> QuotaStatus {
    let record = get_usage_record(env, storage, subscription_id, metric.clone());
    let quotas = quota::get_plan_quotas(env, storage, plan_id);

    let maybe_quota = quotas.iter().find(|q| q.metric == metric);
    if maybe_quota.is_none() {
        return QuotaStatus::WithinLimit;
    }

    let quota = maybe_quota.unwrap();
    let total_limit = quota.limit + record.rollover_balance;

    if record.current_usage >= total_limit {
        QuotaStatus::HardLimitReached
    } else if record.current_usage >= (total_limit * 80) / 100 {
        QuotaStatus::SoftLimitReached
    } else {
        QuotaStatus::WithinLimit
    }
}
