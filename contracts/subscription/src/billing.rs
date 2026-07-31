use soroban_sdk::{contracttype, Env, Vec};
use subtrackr_types::{BillingSchedule, Interval, Subscription};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
enum BillingStoreKey {
    Schedule(u64),
    ScheduleCount,
}

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: BillingStoreKey, val: V) {
    env.storage().persistent().set(&key, &val);
}

fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, key: BillingStoreKey) -> Option<V> {
    env.storage().persistent().get(&key)
}

/// Store a billing schedule for a subscription.
pub(crate) fn set_billing_schedule(env: &Env, subscription_id: u64, schedule: &BillingSchedule) {
    put(env, BillingStoreKey::Schedule(subscription_id), schedule.clone());
}

/// Retrieve the billing schedule for a subscription.
pub(crate) fn get_billing_schedule(env: &Env, subscription_id: u64) -> Option<BillingSchedule> {
    get(env, BillingStoreKey::Schedule(subscription_id))
}

/// Compute the next billing timestamp given a schedule and reference time.
pub(crate) fn calculate_next_billing(
    schedule: &BillingSchedule,
    from_timestamp: u64,
) -> u64 {
    let interval_secs = schedule.interval.seconds();
    let aligned = if schedule.start_date > 0 {
        let elapsed = from_timestamp.saturating_sub(schedule.start_date);
        let periods = elapsed / interval_secs + 1;
        schedule.start_date + periods * interval_secs
    } else {
        from_timestamp + interval_secs
    };

    if schedule.custom_invoice_day > 0 && schedule.custom_invoice_day <= 31 {
        apply_custom_invoice_day(aligned, schedule.custom_invoice_day)
    } else {
        aligned
    }
}

fn apply_custom_invoice_day(timestamp: u64, day: u32) -> u64 {
    let seconds_in_day = 86400u64;
    let days_from_epoch = timestamp / seconds_in_day;
    let day_of_month = days_from_epoch % 30;
    let month_start = timestamp - day_of_month * seconds_in_day;
    let target_day = (day as u64).saturating_sub(1).min(29);
    month_start + target_day * seconds_in_day
}

/// Calculate the prorated amount for a first billing that starts mid-period.
pub(crate) fn calculate_prorated_first_billing(
    price: i128,
    full_interval_secs: u64,
    remaining_secs: u64,
) -> i128 {
    if full_interval_secs == 0 || remaining_secs >= full_interval_secs {
        return price;
    }
    price * remaining_secs as i128 / full_interval_secs as i128
}

/// Get the number of seconds remaining in the current billing period.
pub(crate) fn remaining_seconds(sub: &Subscription, now: u64) -> u64 {
    if now >= sub.last_charged_at {
        sub.next_charge_at.saturating_sub(now)
    } else {
        0
    }
}

/// Preview future billing dates and amounts over N periods.
pub(crate) fn get_billing_preview(
    env: &Env,
    schedule: &BillingSchedule,
    price: i128,
    next_charge_at: u64,
    periods: u32,
) -> Vec<BillingPreviewItem> {
    let mut items: Vec<BillingPreviewItem> = Vec::new(env);
    let mut current = next_charge_at;
    let mut remaining_promo_secs = schedule.promotional_duration_days as u64 * 86400;

    let mut i = 0u32;
    while i < periods {
        let amount = if remaining_promo_secs > 0 && schedule.promotional_rate > 0 {
            let period_secs = schedule.interval.seconds();
            if remaining_promo_secs >= period_secs {
                remaining_promo_secs = remaining_promo_secs.saturating_sub(period_secs);
                schedule.promotional_rate
            } else {
                let promo_frac = remaining_promo_secs as i128;
                let full_frac = period_secs as i128;
                remaining_promo_secs = 0;
                schedule.promotional_rate * promo_frac / full_frac + price * (full_frac - promo_frac) / full_frac
            }
        } else {
            price
        };

        items.push_back(BillingPreviewItem {
            charge_at: current,
            amount,
        });

        current = calculate_next_billing(schedule, current);
        i += 1;
    }

    items
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BillingPreviewItem {
    pub charge_at: u64,
    pub amount: i128,
}
