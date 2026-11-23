use soroban_sdk::{contracttype, BytesN, Env, Vec};
use subtrackr_types::{BillingSchedule, Subscription};

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BillingProviderType {
    SorobanNative = 0,
    EVMBridge = 1,
    Web2Stripe = 2,
    Web2PayPal = 3,
    Web2WireAch = 4,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BillingError {
    InvalidAmount = 1,
    ProviderDisabled = 2,
    AmountBelowMinimum = 3,
    AmountAboveMaximum = 4,
    SettlementNotFound = 5,
    AlreadyRefunded = 6,
}


#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BillingProviderConfig {
    pub provider_type: BillingProviderType,
    pub enabled: bool,
    pub fee_basis_points: u32,
    pub min_amount: i128,
    pub max_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProviderSettlementRecord {
    pub subscription_id: u64,
    pub invoice_id: u64,
    pub provider_type: BillingProviderType,
    pub amount: i128,
    pub fee: i128,
    pub net_amount: i128,
    pub settled_at: u64,
    pub reference_hash: BytesN<32>,
    pub is_refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
enum BillingStoreKey {
    Schedule(u64),
    ScheduleCount,
    ProviderConfig(BillingProviderType),
    Settlement(u64, u64),
    SettlementCount,
}

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: BillingStoreKey, val: V) {
    env.storage().persistent().set(&key, &val);
}

fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: BillingStoreKey,
) -> Option<V> {
    env.storage().persistent().get(&key)
}

/// Store a billing schedule for a subscription.
pub fn set_billing_schedule(env: &Env, subscription_id: u64, schedule: &BillingSchedule) {
    put(
        env,
        BillingStoreKey::Schedule(subscription_id),
        schedule.clone(),
    );
}

/// Retrieve the billing schedule for a subscription.
pub fn get_billing_schedule(env: &Env, subscription_id: u64) -> Option<BillingSchedule> {
    get(env, BillingStoreKey::Schedule(subscription_id))
}

/// Compute the next billing timestamp given a schedule and reference time.
pub fn calculate_next_billing(schedule: &BillingSchedule, from_timestamp: u64) -> u64 {
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
pub fn calculate_prorated_first_billing(
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
pub fn remaining_seconds(sub: &Subscription, now: u64) -> u64 {
    if now >= sub.last_charged_at {
        sub.next_charge_at.saturating_sub(now)
    } else {
        0
    }
}

/// Preview future billing dates and amounts over N periods.
pub fn get_billing_preview(
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
                schedule.promotional_rate * promo_frac / full_frac
                    + price * (full_frac - promo_frac) / full_frac
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

// ── Multi-Provider Strategy Support ──────────────────────────────────────────

/// Set or update the configuration for a billing provider.
pub fn set_provider_config(
    env: &Env,
    provider_type: BillingProviderType,
    config: &BillingProviderConfig,
) {
    put(
        env,
        BillingStoreKey::ProviderConfig(provider_type),
        config.clone(),
    );
}

/// Retrieve the configuration for a billing provider.
pub fn get_provider_config(
    env: &Env,
    provider_type: BillingProviderType,
) -> Option<BillingProviderConfig> {
    get(env, BillingStoreKey::ProviderConfig(provider_type))
}

/// Calculate the provider fee based on basis points (1 bp = 0.01%).
pub fn calculate_provider_fee(amount: i128, fee_basis_points: u32) -> i128 {
    if amount <= 0 || fee_basis_points == 0 {
        return 0;
    }
    (amount * fee_basis_points as i128) / 10_000
}

/// Record a settlement event from a Web2 or Web3 billing provider.
pub fn record_provider_settlement(
    env: &Env,
    subscription_id: u64,
    invoice_id: u64,
    provider_type: BillingProviderType,
    amount: i128,
    reference_hash: BytesN<32>,
) -> Result<ProviderSettlementRecord, BillingError> {
    if amount <= 0 {
        return Err(BillingError::InvalidAmount);
    }

    let config = get_provider_config(env, provider_type);
    if let Some(cfg) = &config {
        if !cfg.enabled {
            return Err(BillingError::ProviderDisabled);
        }
        if cfg.min_amount > 0 && amount < cfg.min_amount {
            return Err(BillingError::AmountBelowMinimum);
        }
        if cfg.max_amount > 0 && amount > cfg.max_amount {
            return Err(BillingError::AmountAboveMaximum);
        }
    }

    let fee_bps = config.as_ref().map(|c| c.fee_basis_points).unwrap_or(0);
    let fee = calculate_provider_fee(amount, fee_bps);
    let net_amount = amount.saturating_sub(fee);
    let settled_at = env.ledger().timestamp();

    let record = ProviderSettlementRecord {
        subscription_id,
        invoice_id,
        provider_type,
        amount,
        fee,
        net_amount,
        settled_at,
        reference_hash,
        is_refunded: false,
    };

    put(
        env,
        BillingStoreKey::Settlement(subscription_id, invoice_id),
        record.clone(),
    );

    let count: u64 = get(env, BillingStoreKey::SettlementCount).unwrap_or(0);
    put(env, BillingStoreKey::SettlementCount, count + 1);

    Ok(record)
}

/// Retrieve the settlement record for a specific subscription and invoice.
pub fn get_provider_settlement(
    env: &Env,
    subscription_id: u64,
    invoice_id: u64,
) -> Option<ProviderSettlementRecord> {
    get(
        env,
        BillingStoreKey::Settlement(subscription_id, invoice_id),
    )
}

/// Mark a settlement record as refunded.
pub fn refund_provider_settlement(
    env: &Env,
    subscription_id: u64,
    invoice_id: u64,
) -> Result<ProviderSettlementRecord, BillingError> {
    let mut record: ProviderSettlementRecord = get(
        env,
        BillingStoreKey::Settlement(subscription_id, invoice_id),
    )
    .ok_or(BillingError::SettlementNotFound)?;

    if record.is_refunded {
        return Err(BillingError::AlreadyRefunded);
    }

    record.is_refunded = true;
    put(
        env,
        BillingStoreKey::Settlement(subscription_id, invoice_id),
        record.clone(),
    );

    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_provider_config_and_fee_calculation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, crate::SubTrackrSubscription);
        env.as_contract(&contract_id, || {
            let provider = BillingProviderType::Web2Stripe;

            let config = BillingProviderConfig {
                provider_type: provider,
                enabled: true,
                fee_basis_points: 290, // 2.9%
                min_amount: 100,
                max_amount: 100_000,
            };

            set_provider_config(&env, provider, &config);
            let fetched = get_provider_config(&env, provider).expect("provider config found");
            assert_eq!(fetched.fee_basis_points, 290);
            assert!(fetched.enabled);

            let fee = calculate_provider_fee(10_000, 290);
            assert_eq!(fee, 290);
        });
    }

    #[test]
    fn test_record_and_retrieve_settlement() {
        let env = Env::default();
        let contract_id = env.register_contract(None, crate::SubTrackrSubscription);
        env.as_contract(&contract_id, || {
            let sub_id = 101u64;
            let invoice_id = 202u64;
            let ref_hash = BytesN::from_array(&env, &[7u8; 32]);

            let config = BillingProviderConfig {
                provider_type: BillingProviderType::SorobanNative,
                enabled: true,
                fee_basis_points: 0,
                min_amount: 50,
                max_amount: 500_000,
            };
            set_provider_config(&env, BillingProviderType::SorobanNative, &config);

            let res = record_provider_settlement(
                &env,
                sub_id,
                invoice_id,
                BillingProviderType::SorobanNative,
                1_000,
                ref_hash.clone(),
            );
            assert!(res.is_ok());

            let record =
                get_provider_settlement(&env, sub_id, invoice_id).expect("settlement exists");
            assert_eq!(record.amount, 1_000);
            assert_eq!(record.net_amount, 1_000);
            assert_eq!(record.fee, 0);
            assert!(!record.is_refunded);

            let refund_res = refund_provider_settlement(&env, sub_id, invoice_id);
            assert!(refund_res.is_ok());
            let updated = get_provider_settlement(&env, sub_id, invoice_id).unwrap();
            assert!(updated.is_refunded);

            // Cannot double refund
            assert_eq!(
                refund_provider_settlement(&env, sub_id, invoice_id),
                Err(BillingError::AlreadyRefunded)
            );
        });
    }

    #[test]
    fn test_provider_min_max_enforcement() {
        let env = Env::default();
        let contract_id = env.register_contract(None, crate::SubTrackrSubscription);
        env.as_contract(&contract_id, || {
            let ref_hash = BytesN::from_array(&env, &[1u8; 32]);

            let config = BillingProviderConfig {
                provider_type: BillingProviderType::Web2PayPal,
                enabled: true,
                fee_basis_points: 349,
                min_amount: 500,
                max_amount: 10_000,
            };
            set_provider_config(&env, BillingProviderType::Web2PayPal, &config);

            // Below min
            let err_low = record_provider_settlement(
                &env,
                1,
                1,
                BillingProviderType::Web2PayPal,
                499,
                ref_hash.clone(),
            );
            assert_eq!(err_low, Err(BillingError::AmountBelowMinimum));

            // Above max
            let err_high = record_provider_settlement(
                &env,
                1,
                2,
                BillingProviderType::Web2PayPal,
                10_001,
                ref_hash.clone(),
            );
            assert_eq!(err_high, Err(BillingError::AmountAboveMaximum));

            // Within range
            let ok = record_provider_settlement(
                &env,
                1,
                3,
                BillingProviderType::Web2PayPal,
                5_000,
                ref_hash,
            );
            assert!(ok.is_ok());
        });
    }
}
