use soroban_sdk::{Address, Env, Vec};
use subtrackr_types::{Quota, StorageKey};
use crate::{storage_persistent_get, storage_persistent_set};

pub fn set_plan_quotas(env: &Env, storage: &Address, plan_id: u64, quotas: Vec<Quota>) {
    storage_persistent_set(env, storage, StorageKey::PlanQuotas(plan_id), quotas);
}

pub fn get_plan_quotas(env: &Env, storage: &Address, plan_id: u64) -> Vec<Quota> {
    storage_persistent_get(env, storage, StorageKey::PlanQuotas(plan_id)).unwrap_or(Vec::new(env))
}
