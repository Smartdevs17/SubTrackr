#![no_std]

use soroban_sdk::{Address, Env, Val};
use subtrackr_types::StorageKey;

#[cfg(test)]
mod transient_storage_tests;

fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&StorageKey::Admin)
}

fn stored_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::Admin)
        .expect("Admin not set")
}

fn authorized_implementation(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::ProxyImplementation)
        .expect("Implementation not set")
}

fn require_implementation_auth(env: &Env) {
    let impl_addr = authorized_implementation(env);
    impl_addr.require_auth();
}

#[soroban_sdk::contract]
pub struct SubTrackrStorage;

#[soroban_sdk::contractimpl]
impl SubTrackrStorage {
    pub fn initialize(env: Env, admin: Address, implementation: Address) {
        if is_initialized(&env) {
            panic!("Already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&StorageKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&StorageKey::ProxyImplementation, &implementation);

        env.storage().instance().set(&StorageKey::PlanCount, &0u64);
        env.storage()
            .instance()
            .set(&StorageKey::SubscriptionCount, &0u64);
    }

    /// Admin-only: update which implementation contract is authorized to write state.
    pub fn set_implementation(env: Env, admin: Address, new_implementation: Address) {
        let stored_admin = stored_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();

        env.storage()
            .instance()
            .set(&StorageKey::ProxyImplementation, &new_implementation);
    }

    pub fn get_admin(env: Env) -> Address {
        stored_admin(&env)
    }

    pub fn get_implementation(env: Env) -> Address {
        authorized_implementation(&env)
    }

    pub fn set_access_control(env: Env, admin: Address, access_control: Address) {
        let stored_admin = stored_admin(&env);
        assert!(admin == stored_admin, "Admin mismatch");
        stored_admin.require_auth();
        env.storage()
            .instance()
            .set(&StorageKey::AccessControl, &access_control);
    }

    pub fn get_access_control(env: Env) -> Option<Address> {
        env.storage().instance().get(&StorageKey::AccessControl)
    }

    // ── Generic storage bridge ──
    //
    // These methods accept `Val` so callers can pass any `#[contracttype]`
    // key (e.g. `StorageKey` or `StorageKeyExt`).  The key is stored
    // using its XDR-encoded `Val` representation directly.

    pub fn instance_get(env: Env, key: Val) -> Option<Val> {
        env.storage().instance().get(&key)
    }

    pub fn instance_set(env: Env, key: Val, value: Val) {
        require_implementation_auth(&env);
        env.storage().instance().set(&key, &value);
    }

    pub fn instance_remove(env: Env, key: Val) {
        require_implementation_auth(&env);
        env.storage().instance().remove(&key);
    }

    pub fn persistent_get(env: Env, key: Val) -> Option<Val> {
        env.storage().persistent().get(&key)
    }

    pub fn persistent_set(env: Env, key: Val, value: Val) {
        require_implementation_auth(&env);
        env.storage().persistent().set(&key, &value);
    }

    pub fn persistent_remove(env: Env, key: Val) {
        require_implementation_auth(&env);
        env.storage().persistent().remove(&key);
    }

    // ── Temporary (transient) storage bridge ──

    pub fn temporary_get(env: Env, key: Val) -> Option<Val> {
        env.storage().temporary().get(&key)
    }

    pub fn temporary_set(env: Env, key: Val, value: Val, ttl_ledgers: u32) {
        require_implementation_auth(&env);
        let effective_ttl = if ttl_ledgers == 0 { 1 } else { ttl_ledgers };
        env.storage().temporary().set(&key, &value);
        env.storage()
            .temporary()
            .extend_ttl(&key, effective_ttl, effective_ttl);
    }

    pub fn temporary_remove(env: Env, key: Val) {
        require_implementation_auth(&env);
        env.storage().temporary().remove(&key);
    }

    pub fn temporary_extend_ttl(env: Env, key: Val, threshold: u32, extend_to: u32) {
        require_implementation_auth(&env);
        env.storage()
            .temporary()
            .extend_ttl(&key, threshold, extend_to);
    }
}
