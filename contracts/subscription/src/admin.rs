/// Admin Operations Module
///
/// Handles initialization, oracle configuration, rate limiting, and admin utilities.
use soroban_sdk::{Address, Env, String, Symbol, Vec};

use crate::get_admin;
use crate::storage_instance_get;
use crate::storage_instance_remove;
use crate::storage_instance_set;
use crate::storage_persistent_get;
use crate::storage_persistent_remove;
use crate::storage_persistent_set;
use subtrackr_types::{PriceBounds, StorageKey};

pub fn initialize(env: &Env, storage: &Address, admin: Address) {
    admin.require_auth();

    storage_instance_set(env, storage, StorageKey::Admin, admin);
    storage_instance_set(env, storage, StorageKey::PlanCount, 0u64);
    storage_instance_set(env, storage, StorageKey::SubscriptionCount, 0u64);
    storage_instance_remove(env, storage, StorageKey::InvoiceContract);
}

pub fn set_invoice_contract(env: &Env, storage: &Address, invoice: Address) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_set(env, storage, StorageKey::InvoiceContract, invoice);
}

pub fn clear_invoice_contract(env: &Env, storage: &Address) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_remove(env, storage, StorageKey::InvoiceContract);
}

pub fn set_oracle_contract(env: &Env, storage: &Address, oracle: Address) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_set(env, storage, StorageKey::OracleContract, oracle);
}

pub fn clear_oracle_contract(env: &Env, storage: &Address) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_remove(env, storage, StorageKey::OracleContract);
}

pub fn get_oracle_contract(env: &Env, storage: &Address) -> Option<Address> {
    storage_instance_get(env, storage, StorageKey::OracleContract)
}

pub fn set_price_bounds(env: &Env, storage: &Address, merchant: &Address, plan_id: u64, bounds: PriceBounds) {
    merchant.require_auth();
    let plan_data: subtrackr_types::Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(plan_id)).expect("Plan not found");
    assert!(plan_data.merchant == *merchant, "Only plan owner can set bounds");
    assert!(bounds.max_price_bps >= bounds.min_price_bps, "Max must be >= min");
    assert!(bounds.max_price_bps > 0, "Max must be positive");
    storage_persistent_set(env, storage, StorageKey::PriceBounds(plan_id), bounds);
}

pub fn clear_price_bounds(env: &Env, storage: &Address, merchant: &Address, plan_id: u64) {
    merchant.require_auth();
    let plan_data: subtrackr_types::Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(plan_id)).expect("Plan not found");
    assert!(plan_data.merchant == *merchant, "Only plan owner can clear bounds");
    storage_persistent_remove(env, storage, StorageKey::PriceBounds(plan_id));
}

pub fn get_price_bounds(env: &Env, storage: &Address, plan_id: u64) -> Option<PriceBounds> {
    storage_persistent_get(env, storage, StorageKey::PriceBounds(plan_id))
}

pub fn get_oracle_price(
    env: &Env, storage: &Address, token: Symbol, quote: Symbol, ttl: u64,
) -> i128 {
    let oracle: Address =
        storage_instance_get(env, storage, StorageKey::OracleContract).expect("Oracle not set");
    #[cfg(feature = "oracle")]
    {
        let client = subtrackr_oracle::SubTrackrOracleClient::new(env, &oracle);
        let price = client.get_price_with_cache(&token, &quote, &ttl);
        return price.value;
    }
    #[cfg(not(feature = "oracle"))]
    {
        let _ = (oracle, token, quote, ttl);
        panic!("oracle feature not enabled");
    }
}

pub fn set_token_symbol(env: &Env, storage: &Address, token: Address, symbol: Symbol) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_set(env, storage, StorageKey::TokenSymbol(token), symbol);
}

pub fn remove_token_symbol(env: &Env, storage: &Address, token: Address) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_remove(env, storage, StorageKey::TokenSymbol(token));
}

pub fn get_token_symbol(env: &Env, storage: &Address, token: Address) -> Option<Symbol> {
    storage_instance_get(env, storage, StorageKey::TokenSymbol(token))
}

pub fn set_rate_limit(env: &Env, storage: &Address, function: String, min_interval_secs: u64) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_set(env, storage, StorageKey::RateLimit(function), min_interval_secs);
}

pub fn remove_rate_limit(env: &Env, storage: &Address, function: String) {
    let admin = get_admin(env, storage);
    admin.require_auth();
    storage_instance_remove(env, storage, StorageKey::RateLimit(function));
}

pub fn set_plan_quotas(
    env: &Env, storage: &Address, merchant: Address, plan_id: u64, quotas: Vec<subtrackr_types::Quota>,
) {
    merchant.require_auth();
    let plan_data: subtrackr_types::Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(plan_id)).expect("Plan not found");
    assert!(plan_data.merchant == merchant, "Only plan owner can set quotas");
    crate::quota::set_plan_quotas(env, storage, plan_id, quotas);
}

pub fn get_plan_quotas(env: &Env, storage: &Address, plan_id: u64) -> Vec<subtrackr_types::Quota> {
    crate::quota::get_plan_quotas(env, storage, plan_id)
}

pub fn record_usage(
    env: &Env, storage: &Address, subscription_id: u64,
    metric: subtrackr_types::QuotaMetric, amount: u64,
) -> subtrackr_types::UsageRecord {
    let sub: subtrackr_types::Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");
    crate::usage::record_usage(env, storage, subscription_id, sub.plan_id, metric, amount)
}

pub fn get_usage_record(
    env: &Env, storage: &Address, subscription_id: u64, metric: subtrackr_types::QuotaMetric,
) -> subtrackr_types::UsageRecord {
    crate::usage::get_usage_record(env, storage, subscription_id, metric)
}

pub fn check_quota(
    env: &Env, storage: &Address, subscription_id: u64, metric: subtrackr_types::QuotaMetric,
) -> subtrackr_types::QuotaStatus {
    let sub: subtrackr_types::Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");
    crate::usage::check_quota(env, storage, subscription_id, sub.plan_id, metric)
}
