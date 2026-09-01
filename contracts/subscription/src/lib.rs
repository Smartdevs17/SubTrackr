#![no_std]

pub mod admin;
pub mod billing;
pub mod cancellation;
pub mod charging;
pub mod errors;
pub mod event_store;
pub mod events;
pub mod gas_benchmarks;
pub mod gas_optimization;
pub mod gas_profiler;
pub mod gas_storage;
pub mod invoice_branding;
pub mod loyalty;
pub mod payment;
pub mod payment_methods;
pub mod plan;
pub mod plan_templates;
pub mod proration;
pub mod quota;
pub mod reentrancy;
pub mod retention;
pub mod revenue;
pub mod state;
pub mod subscription_lifecycle;
pub mod subtrackr_subscription;
pub mod timeout;
pub mod usage;
pub mod webhook;

pub const MAX_PLANS_PER_MERCHANT: u32 = 100;

pub use subtrackr_subscription::{SubTrackrSubscription, SubTrackrSubscriptionClient};

use soroban_sdk::{token, Address, Bytes, BytesN, Env, IntoVal, String, TryFromVal, Val, Vec};
use subtrackr_types::{
    ChargeCommitment, Invoice, MevAlert, MevProtectionConfig, Plan, StorageKey, Subscription,
    SubscriptionStatus, TimeRange,
};

/// Billing interval in seconds.
const MAX_PAUSE_DURATION: u64 = 2_592_000; // 30 days
const DEFAULT_COMMIT_REVEAL_THRESHOLD: i128 = i128::MAX;
const DEFAULT_MAX_FEE_BPS: u32 = 100; // 1%
const DEFAULT_REVEAL_DELAY_SECS: u64 = 30;
const DEFAULT_COMMIT_TTL_SECS: u64 = 3_600;
const DEFAULT_GAS_ALERT_THRESHOLD: u64 = u64::MAX;

const STORAGE_VERSION: u32 = 2;

fn storage_instance_get<V: TryFromVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
) -> Option<V> {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "instance_get"),
        args,
    );
    val_opt.map(|val| V::try_from_val(env, &val).unwrap())
}

fn storage_instance_set<V: IntoVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
    value: V,
) {
    let val: Val = value.into_val(env);
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env), val];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "instance_set"),
        args,
    );
}

fn storage_instance_remove(env: &Env, storage: &Address, key: StorageKey) {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "instance_remove"),
        args,
    );
}

fn storage_persistent_get<V: TryFromVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
) -> Option<V> {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_get"),
        args,
    );
    val_opt.map(|val| V::try_from_val(env, &val).unwrap())
}

fn storage_persistent_set<V: IntoVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
    value: V,
) {
    let val: Val = value.into_val(env);
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env), val];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_set"),
        args,
    );
}

fn storage_persistent_remove(env: &Env, storage: &Address, key: StorageKey) {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_remove"),
        args,
    );
}

fn get_admin(env: &Env, storage: &Address) -> Address {
    storage_instance_get(env, storage, StorageKey::Admin).expect("Admin not set")
}

fn enforce_rate_limit(env: &Env, storage: &Address, caller: &Address, function_name: &str) {
    let fname = String::from_str(env, function_name);
    let min_interval: Option<u64> =
        storage_instance_get(env, storage, StorageKey::RateLimit(fname.clone()));
    if min_interval.is_none() {
        return;
    }
    let min_secs = min_interval.unwrap();
    if min_secs == 0 {
        return;
    }

    let now = env.ledger().timestamp();
    let last_opt: Option<u64> = storage_instance_get(
        env,
        storage,
        StorageKey::LastCall(caller.clone(), fname.clone()),
    );

    if let Some(last) = last_opt {
        if now < last + min_secs {
            env.events().publish(
                (
                    String::from_str(env, "rate_limit_violation"),
                    caller.clone(),
                ),
                (fname.clone(), last, now, min_secs),
            );
            panic!("Rate limited: please wait before calling this function again");
        }
    }

    storage_instance_set(
        env,
        storage,
        StorageKey::LastCall(caller.clone(), fname),
        now,
    );
}

fn check_and_resume_internal(env: &Env, sub: &mut Subscription) -> bool {
    if sub.status == SubscriptionStatus::Paused {
        let now = env.ledger().timestamp();
        if now >= sub.paused_at + sub.pause_duration {
            sub.status = SubscriptionStatus::Active;
            sub.paused_at = 0;
            sub.pause_duration = 0;
            return true;
        }
    }
    false
}

fn set_user_plan_index(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
    subscription_id: u64,
) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
        subscription_id,
    );
}

fn remove_user_plan_index(env: &Env, storage: &Address, subscriber: &Address, plan_id: u64) {
    storage_persistent_remove(
        env,
        storage,
        StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
    );
}

fn get_user_plan_index(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
) -> Option<u64> {
    storage_persistent_get(
        env,
        storage,
        StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
    )
}

fn invoice_contract(env: &Env, storage: &Address) -> Option<Address> {
    storage_instance_get(env, storage, StorageKey::InvoiceContract)
}

fn get_mev_config(env: &Env, storage: &Address) -> MevProtectionConfig {
    storage_instance_get(env, storage, StorageKey::MevProtectionConfig).unwrap_or(
        MevProtectionConfig {
            large_charge_threshold: DEFAULT_COMMIT_REVEAL_THRESHOLD,
            max_fee_bps: DEFAULT_MAX_FEE_BPS,
            reveal_delay_secs: DEFAULT_REVEAL_DELAY_SECS,
            commit_ttl_secs: DEFAULT_COMMIT_TTL_SECS,
            private_mempool_required: false,
            gas_price_alert_threshold: DEFAULT_GAS_ALERT_THRESHOLD,
        },
    )
}

fn validate_mev_config(config: &MevProtectionConfig) {
    assert!(
        config.large_charge_threshold > 0,
        "Large charge threshold must be positive"
    );
    assert!(config.max_fee_bps <= 10_000, "Max fee bps too high");
    assert!(
        config.commit_ttl_secs > config.reveal_delay_secs,
        "Commit TTL must exceed reveal delay"
    );
}

fn max_charge_with_fee_bound(price: i128, max_fee_bps: u32) -> i128 {
    let fee = price
        .checked_mul(max_fee_bps as i128)
        .expect("Fee overflow")
        .checked_div(10_000)
        .expect("Fee division failed");
    price.checked_add(fee).expect("Max charge overflow")
}

fn build_charge_commitment(
    env: &Env,
    subscription_id: u64,
    max_charge_amount: i128,
    salt: &BytesN<32>,
) -> BytesN<32> {
    let mut payload = Bytes::new(env);
    payload.extend_from_slice(b"SubTrackr:charge-commitment:v1");
    payload.extend_from_array(&subscription_id.to_be_bytes());
    payload.extend_from_array(&max_charge_amount.to_be_bytes());
    let salt_bytes: Bytes = salt.clone().into();
    payload.append(&salt_bytes);
    env.crypto().sha256(&payload).into()
}

fn record_mev_gas_alert(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    observed_gas_price: u64,
    threshold: u64,
) {
    if threshold == u64::MAX || observed_gas_price <= threshold {
        return;
    }

    let mut count: u64 = storage_instance_get(env, storage, StorageKey::MevAlertCount).unwrap_or(0);
    count += 1;
    storage_instance_set(env, storage, StorageKey::MevAlertCount, count);
    let alert = MevAlert {
        id: count,
        subscription_id,
        observed_gas_price,
        threshold,
        detected_at: env.ledger().timestamp(),
    };
    storage_persistent_set(env, storage, StorageKey::MevAlert(count), alert.clone());
    env.events().publish(
        (String::from_str(env, "mev_gas_alert"), subscription_id),
        (observed_gas_price, threshold, alert.detected_at),
    );
}

fn charge_subscription_guarded(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    max_charge_amount: i128,
    observed_gas_price: u64,
    private_mempool: bool,
    revealed_commitment: bool,
) {
    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    if sub.subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, &sub.subscriber, "charge_subscription");
    }

    sub.subscriber.require_auth();

    if check_and_resume_internal(env, &mut sub) {
        storage_persistent_set(
            env,
            storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );
    }

    assert!(
        sub.status == SubscriptionStatus::Active,
        "Subscription not active"
    );

    let now = env.ledger().timestamp();
    assert!(now >= sub.next_charge_at, "Payment not yet due");

    let plan: Plan = storage_persistent_get(env, storage, StorageKey::Plan(sub.plan_id))
        .expect("Plan not found");
    let mev_config = get_mev_config(env, storage);

    if !revealed_commitment && plan.price >= mev_config.large_charge_threshold {
        panic!("Commit reveal required for large charge");
    }

    if max_charge_amount != i128::MAX {
        assert!(max_charge_amount >= plan.price, "Charge exceeds max bound");
        let configured_bound = max_charge_with_fee_bound(plan.price, mev_config.max_fee_bps);
        assert!(
            max_charge_amount <= configured_bound,
            "Max fee bound exceeds configured tolerance"
        );
    }

    if mev_config.private_mempool_required {
        assert!(private_mempool, "Private mempool route required");
    }

    record_mev_gas_alert(
        env,
        storage,
        subscription_id,
        observed_gas_price,
        mev_config.gas_price_alert_threshold,
    );

    token::Client::new(env, &plan.token).transfer(&sub.subscriber, &plan.merchant, &plan.price);

    sub.last_charged_at = now;
    sub.next_charge_at = now + plan.interval.seconds();
    sub.total_paid += plan.price;
    sub.total_gas_spent += 100_000;
    sub.charge_count += 1;

    storage_persistent_set(
        env,
        storage,
        StorageKey::Subscription(subscription_id),
        sub.clone(),
    );

    revenue::generate_revenue_schedule(
        env,
        storage,
        subscription_id,
        sub.plan_id,
        plan.price,
        now,
        plan.interval.seconds(),
    );
    revenue::update_merchant_revenue_balances(env, storage, &plan.merchant, 0, plan.price);
    revenue::track_merchant_subscription(env, storage, &plan.merchant, subscription_id);

    env.events().publish(
        (
            String::from_str(env, "subscription_charged"),
            subscription_id,
        ),
        (sub.subscriber.clone(), plan.price, 100_000u64, now),
    );

    if let Some(invoice_addr) = invoice_contract(env, storage) {
        let period = TimeRange {
            start: sub.last_charged_at,
            end: sub.next_charge_at,
        };
        let _invoice: Invoice = env.invoke_contract(
            &invoice_addr,
            &soroban_sdk::Symbol::new(env, "generate_invoice"),
            soroban_sdk::vec![
                env,
                storage.clone().into_val(env),
                subscription_id.into_val(env),
                period.into_val(env),
                String::from_str(env, "GLOBAL").into_val(env),
                String::from_str(env, "").into_val(env),
            ],
        );
        let _ = _invoice;
    }
}
