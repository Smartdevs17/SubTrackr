#![no_std]
use soroban_sdk::{Address, Env};

// We use generics `<M>` for the metric to automatically accept `QuotaMetric`
// from `lib.rs` without needing to directly import it here.

pub fn record_usage<M>(
    _env: &Env,
    _storage: &Address,
    _subscription_id: u64,
    _plan_id: u64,
    _metric: M,
    _amount: u64,
) -> subtrackr_types::UsageRecord {
    // Satisfies the compiler return type perfectly
    unimplemented!("usage tracking logic to be implemented")
}

pub fn get_usage_record<M>(
    _env: &Env,
    _storage: &Address,
    _subscription_id: u64,
    _metric: M,
) -> subtrackr_types::UsageRecord {
    unimplemented!("usage tracking logic to be implemented")
}

pub fn check_quota<M>(
    _env: &Env,
    _storage: &Address,
    _subscription_id: u64,
    _plan_id: u64,
    _metric: M,
) -> subtrackr_types::QuotaStatus {
    unimplemented!("usage tracking logic to be implemented")
}
