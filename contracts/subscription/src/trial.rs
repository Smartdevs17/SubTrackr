#![allow(dead_code)]
//! Subscription Trial Management and Conversion Optimization Module (Soroban)
//!
//! Provides on-chain trial lifecycle tracking, conversion incentive mechanics,
//! grace period calculations, dynamic conversion discounts, and trial conversion analytics.

use soroban_sdk::{contracttype, Address, Env, String, Vec};
use subtrackr_types::{StorageKey};

use crate::{storage_persistent_get, storage_persistent_set};

/// Basis point denominator (100% = 10,000 bps)
pub const BPS_DENOMINATOR: u32 = 10_000;
pub const DEFAULT_TRIAL_DURATION_SECS: u64 = 14 * 86_400; // 14 days
pub const DEFAULT_GRACE_PERIOD_SECS: u64 = 3 * 86_400; // 3 days
pub const MAX_TRIAL_EXTENSIONS: u32 = 3;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum OnChainTrialStatus {
    Active,
    Extended,
    Converted,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OnChainTrialConfig {
    pub plan_id: u64,
    pub duration_secs: u64,
    pub grace_period_secs: u64,
    pub auto_convert: bool,
    pub conversion_discount_bps: u32,
    pub max_extensions: u32,
    pub incentive_extension_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OnChainTrialRecord {
    pub trial_id: u64,
    pub subscriber: Address,
    pub plan_id: u64,
    pub start_time: u64,
    pub end_time: u64,
    pub original_end_time: u64,
    pub extension_count: u32,
    pub conversion_discount_bps: u32,
    pub auto_convert: bool,
    pub status: OnChainTrialStatus,
    pub converted_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TrialConversionMetrics {
    pub plan_id: u64,
    pub total_trials: u64,
    pub active_trials: u64,
    pub converted_trials: u64,
    pub expired_trials: u64,
    pub extended_trials: u64,
    pub conversion_rate_bps: u32,
}

/// Helper key for trial records keyed by subscription/trial id
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TrialStorageKey {
    TrialConfig(u64),
    TrialRecord(u64),
    UserTrialIndex(Address, u64),
    PlanTrialCount(u64),
    PlanConvertedCount(u64),
    PlanExtendedCount(u64),
    PlanExpiredCount(u64),
    TrialCount,
}

pub fn configure_trial_for_plan(
    env: &Env,
    storage: &Address,
    plan_id: u64,
    duration_secs: u64,
    grace_period_secs: u64,
    auto_convert: bool,
    conversion_discount_bps: u32,
    max_extensions: u32,
    incentive_extension_secs: u64,
) -> OnChainTrialConfig {
    assert!(conversion_discount_bps <= BPS_DENOMINATOR, "Discount cannot exceed 100%");
    assert!(duration_secs > 0, "Duration must be positive");

    let config = OnChainTrialConfig {
        plan_id,
        duration_secs: if duration_secs == 0 { DEFAULT_TRIAL_DURATION_SECS } else { duration_secs },
        grace_period_secs: if grace_period_secs == 0 { DEFAULT_GRACE_PERIOD_SECS } else { grace_period_secs },
        auto_convert,
        conversion_discount_bps,
        max_extensions: if max_extensions == 0 { MAX_TRIAL_EXTENSIONS } else { max_extensions },
        incentive_extension_secs,
    };

    config
}

pub fn start_trial(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
    config: &OnChainTrialConfig,
) -> OnChainTrialRecord {
    let now = env.ledger().timestamp();
    let end_time = now + config.duration_secs;

    let trial = OnChainTrialRecord {
        trial_id: now,
        subscriber: subscriber.clone(),
        plan_id,
        start_time: now,
        end_time,
        original_end_time: end_time,
        extension_count: 0,
        conversion_discount_bps: config.conversion_discount_bps,
        auto_convert: config.auto_convert,
        status: OnChainTrialStatus::Active,
        converted_at: None,
    };

    trial
}

pub fn extend_trial(
    env: &Env,
    trial: &mut OnChainTrialRecord,
    config: &OnChainTrialConfig,
    additional_secs: u64,
) -> bool {
    if trial.status != OnChainTrialStatus::Active && trial.status != OnChainTrialStatus::Extended {
        return false;
    }

    if trial.extension_count >= config.max_extensions {
        return false;
    }

    let extension = if additional_secs > 0 {
        additional_secs
    } else {
        config.incentive_extension_secs
    };

    if extension == 0 {
        return false;
    }

    trial.end_time += extension;
    trial.extension_count += 1;
    trial.status = OnChainTrialStatus::Extended;

    true
}

pub fn convert_trial(
    env: &Env,
    trial: &mut OnChainTrialRecord,
    promotional_discount_bps: Option<u32>,
) -> bool {
    if trial.status == OnChainTrialStatus::Converted || trial.status == OnChainTrialStatus::Cancelled {
        return false;
    }

    let now = env.ledger().timestamp();
    trial.status = OnChainTrialStatus::Converted;
    trial.converted_at = Some(now);

    if let Some(discount) = promotional_discount_bps {
        if discount <= BPS_DENOMINATOR {
            trial.conversion_discount_bps = discount;
        }
    }

    true
}

pub fn evaluate_trial_expiration(
    env: &Env,
    trial: &mut OnChainTrialRecord,
    config: &OnChainTrialConfig,
) -> OnChainTrialStatus {
    if trial.status != OnChainTrialStatus::Active && trial.status != OnChainTrialStatus::Extended {
        return trial.status.clone();
    }

    let now = env.ledger().timestamp();
    let total_expiry = trial.end_time + config.grace_period_secs;

    if now > total_expiry {
        if trial.auto_convert {
            trial.status = OnChainTrialStatus::Converted;
            trial.converted_at = Some(now);
        } else {
            trial.status = OnChainTrialStatus::Expired;
        }
    }

    trial.status.clone()
}

pub fn calculate_conversion_metrics(
    plan_id: u64,
    total_trials: u64,
    converted_trials: u64,
    active_trials: u64,
    expired_trials: u64,
    extended_trials: u64,
) -> TrialConversionMetrics {
    let rate_bps = if total_trials > 0 {
        ((converted_trials as u128 * BPS_DENOMINATOR as u128) / total_trials as u128) as u32
    } else {
        0
    };

    TrialConversionMetrics {
        plan_id,
        total_trials,
        active_trials,
        converted_trials,
        expired_trials,
        extended_trials,
        conversion_rate_bps: rate_bps,
    }
}
