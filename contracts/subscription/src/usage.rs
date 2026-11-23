use crate::quota::get_plan_quotas;
use crate::{storage_persistent_get, storage_persistent_set};
use soroban_sdk::{Address, Env};
use subtrackr_types::{Quota, QuotaMetric, QuotaStatus, RolloverPolicy, StorageKey, UsageRecord};

const SOFT_LIMIT_PERCENT: u64 = 80;
const PERCENT_SCALE: u64 = 100;

fn find_metric_quota(
    env: &Env,
    storage: &Address,
    plan_id: u64,
    metric: &QuotaMetric,
) -> Option<Quota> {
    let quotas = get_plan_quotas(env, storage, plan_id);
    for quota in quotas.iter() {
        if quota.metric == *metric {
            return Some(quota);
        }
    }
    None
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

pub fn record_usage(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    plan_id: u64,
    metric: QuotaMetric,
    amount: u64,
) -> UsageRecord {
    let now = env.ledger().timestamp();
    let quota_opt = find_metric_quota(env, storage, plan_id, &metric);

    let mut record: UsageRecord = storage_persistent_get(
        env,
        storage,
        StorageKey::SubscriptionUsage(subscription_id, metric.clone()),
    )
    .unwrap_or(UsageRecord {
        subscription_id,
        metric: metric.clone(),
        current_usage: 0,
        period_start: now,
        rollover_balance: 0,
    });

    if let Some(quota) = quota_opt {
        let period_secs = quota.period.seconds();
        if period_secs > 0 && now >= record.period_start.saturating_add(period_secs) {
            let effective_limit = quota.limit.saturating_add(record.rollover_balance);
            let unused = effective_limit.saturating_sub(record.current_usage);
            let new_rollover = match quota.rollover_policy {
                RolloverPolicy::NoRollover => 0,
                RolloverPolicy::RolloverAll => unused,
                RolloverPolicy::RolloverCap(cap) => core::cmp::min(unused, cap),
            };
            record.period_start = now;
            record.current_usage = 0;
            record.rollover_balance = new_rollover;
        }
    }

    record.current_usage = record.current_usage.saturating_add(amount);

    storage_persistent_set(
        env,
        storage,
        StorageKey::SubscriptionUsage(subscription_id, metric),
        record.clone(),
    );

    record
}

pub fn check_quota(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    plan_id: u64,
    metric: QuotaMetric,
) -> QuotaStatus {
    let record = get_usage_record(env, storage, subscription_id, metric.clone());
    let quota = match find_metric_quota(env, storage, plan_id, &metric) {
        Some(q) => q,
        None => return QuotaStatus::WithinLimit,
    };

    let effective_limit = quota.limit.saturating_add(record.rollover_balance);
    if effective_limit == 0 {
        return if record.current_usage > 0 {
            QuotaStatus::HardLimitReached
        } else {
            QuotaStatus::WithinLimit
        };
    }

    if record.current_usage >= effective_limit {
        return QuotaStatus::HardLimitReached;
    }

    if record.current_usage.saturating_mul(PERCENT_SCALE)
        >= effective_limit.saturating_mul(SOFT_LIMIT_PERCENT)
    {
        return QuotaStatus::SoftLimitReached;
    }

    QuotaStatus::WithinLimit
}
