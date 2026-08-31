use soroban_sdk::{Address, Env, String};

use crate::storage_persistent_get;
use crate::storage_persistent_set;
use subtrackr_types::{StorageKey, TrialConfig, Plan};
use crate::get_admin;
use crate::enforce_rate_limit;

/// Configure a trial for a specific plan
pub fn set_plan_trial(
    env: &Env,
    storage: &Address,
    merchant: &Address,
    plan_id: u64,
    has_trial: bool,
    duration_seconds: u64,
) {
    if *merchant != get_admin(env, storage) {
        enforce_rate_limit(env, storage, merchant, "set_plan_trial");
    }
    merchant.require_auth();

    // Verify the plan exists and belongs to the merchant
    let plan: Plan = storage_persistent_get(env, storage, StorageKey::Plan(plan_id))
        .expect("Plan not found");
    assert!(plan.merchant == *merchant, "Only plan owner can modify trial config");

    let config = TrialConfig {
        has_trial,
        duration_seconds,
    };

    storage_persistent_set(env, storage, StorageKey::PlanTrial(plan_id), config.clone());

    env.events().publish(
        (String::from_str(env, "plan_trial_updated"), plan_id),
        (has_trial, duration_seconds),
    );
}

/// Get trial configuration for a specific plan
pub fn get_plan_trial(
    env: &Env,
    storage: &Address,
    plan_id: u64,
) -> Option<TrialConfig> {
    storage_persistent_get(env, storage, StorageKey::PlanTrial(plan_id))
}
