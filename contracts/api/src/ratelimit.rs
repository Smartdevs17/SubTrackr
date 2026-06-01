use soroban_sdk::Env;
use subtrackr_types::{ApiKey, ApiKeyId, ApiUsageRecord, RateLimitStatus, TimeRange, UsageReport};

use crate::DataKey;

const SECS_PER_MINUTE: u64 = 60;
const SECS_PER_HOUR: u64 = 3_600;
const SECS_PER_DAY: u64 = 86_400;

fn window_start(ts: u64, period: u64) -> u64 {
    ts - (ts % period)
}

fn bump_window(env: &Env, key: DataKey, now: u64, period: u64) -> (u32, u64) {
    let ws = window_start(now, period);
    let record: Option<ApiUsageRecord> = env.storage().instance().get(&key);
    let count = match record {
        Some(r) if r.window_start == ws => r.count + 1,
        _ => 1,
    };
    env.storage().instance().set(
        &key,
        &ApiUsageRecord {
            window_start: ws,
            count,
        },
    );
    (count, ws + period)
}

pub fn check_rate_limit(env: &Env, key: &ApiKey, now: u64) -> RateLimitStatus {
    let cfg = &key.rate_limit;

    let (min_count, min_reset) = bump_window(
        env,
        DataKey::RateLimitMinute(key.id, window_start(now, SECS_PER_MINUTE)),
        now,
        SECS_PER_MINUTE,
    );

    let (hour_count, hour_reset) = bump_window(
        env,
        DataKey::RateLimitHour(key.id, window_start(now, SECS_PER_HOUR)),
        now,
        SECS_PER_HOUR,
    );

    let (day_count, day_reset) = bump_window(
        env,
        DataKey::RateLimitDay(key.id, window_start(now, SECS_PER_DAY)),
        now,
        SECS_PER_DAY,
    );

    let exceeded = if min_count > cfg.requests_per_minute {
        true
    } else if hour_count > cfg.requests_per_hour {
        true
    } else if day_count > cfg.requests_per_day {
        true
    } else {
        false
    };

    if exceeded {
        let reset_at = core::cmp::min(core::cmp::min(min_reset, hour_reset), day_reset);
        let retry_after = reset_at.saturating_sub(now);
        RateLimitStatus {
            is_allowed: false,
            remaining: 0,
            reset_at,
            retry_after,
        }
    } else {
        let rem_min = cfg.requests_per_minute.saturating_sub(min_count);
        let rem_hour = cfg.requests_per_hour.saturating_sub(hour_count);
        let rem_day = cfg.requests_per_day.saturating_sub(day_count);
        let remaining = core::cmp::min(core::cmp::min(rem_min, rem_hour), rem_day);
        let reset_at = core::cmp::min(core::cmp::min(min_reset, hour_reset), day_reset);
        RateLimitStatus {
            is_allowed: true,
            remaining,
            reset_at,
            retry_after: 0,
        }
    }
}

pub fn get_api_usage(env: &Env, key_id: ApiKeyId, period: TimeRange) -> UsageReport {
    let mut total: u32 = 0;
    let mut ws = window_start(period.start, SECS_PER_MINUTE);
    let end = period.end;
    while ws <= end {
        let rec: Option<ApiUsageRecord> = env
            .storage()
            .instance()
            .get(&DataKey::RateLimitMinute(key_id, ws));
        if let Some(r) = rec {
            total = total.saturating_add(r.count);
        }
        ws += SECS_PER_MINUTE;
    }

    UsageReport {
        key_id,
        period,
        total_requests: total,
    }
}

pub fn calculate_api_charge(env: &Env, key: &ApiKey, period: TimeRange) -> i128 {
    let usage = get_api_usage(env, key.id, period);
    let billable = usage.total_requests.saturating_sub(1000);
    let price_per_k = key.usage_tier.price_per_thousand();
    (billable as i128).saturating_mul(price_per_k) / 1000
}
