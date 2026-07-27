/// Plan Management Module
///
/// Handles all plan-related operations: creation, deactivation, and queries.
/// Extracted from the monolithic contract for better maintainability.
use soroban_sdk::{Address, Env, String, Vec};

use crate::enforce_rate_limit;
use crate::get_admin;
use crate::storage_instance_get;
use crate::storage_instance_set;
use crate::storage_persistent_get;
use crate::storage_persistent_set;
use subtrackr_types::{Interval, Plan, StorageKey};

/// Create a new subscription plan for a merchant.
pub fn create_plan(
    env: &Env,
    storage: &Address,
    merchant: &Address,
    name: String,
    price: i128,
    token: Address,
    interval: Interval,
) -> u64 {
    if merchant != get_admin(env, storage) {
        enforce_rate_limit(env, storage, merchant, "create_plan");
    }
    merchant.require_auth();
    assert!(price > 0, "Price must be positive");

    let mut count: u64 = storage_instance_get(env, storage, StorageKey::PlanCount).unwrap_or(0);
    count += 1;

    let plan = Plan {
        id: count,
        merchant: merchant.clone(),
        name,
        price,
        token,
        interval,
        active: true,
        subscriber_count: 0,
        created_at: env.ledger().timestamp(),
    };

    storage_persistent_set(env, storage, StorageKey::Plan(count), plan.clone());
    storage_instance_set(env, storage, StorageKey::PlanCount, count);

    let mut merchant_plans: Vec<u64> = storage_persistent_get(
        env,
        storage,
        StorageKey::MerchantPlans(merchant.clone()),
    )
    .unwrap_or(Vec::new(env));
    merchant_plans.push_back(count);
    storage_persistent_set(
        env,
        storage,
        StorageKey::MerchantPlans(merchant.clone()),
        merchant_plans,
    );

    count
}

/// Deactivate a plan owned by a merchant.
pub fn deactivate_plan(env: &Env, storage: &Address, merchant: &Address, plan_id: u64) {
    if merchant != get_admin(env, storage) {
        enforce_rate_limit(env, storage, merchant, "deactivate_plan");
    }
    merchant.require_auth();

    let mut plan: Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(plan_id)).expect("Plan not found");

    assert!(plan.merchant == merchant, "Only plan owner can deactivate");
    plan.active = false;

    storage_persistent_set(env, storage, StorageKey::Plan(plan_id), plan);
}

/// Get a plan by ID.
pub fn get_plan(env: &Env, storage: &Address, plan_id: u64) -> Plan {
    storage_persistent_get(env, storage, StorageKey::Plan(plan_id)).expect("Plan not found")
}

/// Get the total number of plans.
pub fn get_plan_count(env: &Env, storage: &Address) -> u64 {
    storage_instance_get(env, storage, StorageKey::PlanCount).unwrap_or(0)
}

/// Get all plan IDs for a merchant.
pub fn get_merchant_plans(env: &Env, storage: &Address, merchant: &Address) -> Vec<u64> {
    storage_persistent_get(env, storage, StorageKey::MerchantPlans(merchant.clone()))
        .unwrap_or(Vec::new(env))
}
