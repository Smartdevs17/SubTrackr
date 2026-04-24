#![no_std]

use soroban_sdk::{Address, Env, Val};
use subtrackr_types::StorageKey;

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

    // ── Generic storage bridge ──
    //
    // Reads are public for easier introspection and validations.
    // Writes are restricted to the authorized implementation contract.

    pub fn instance_get(env: Env, key: StorageKey) -> Option<Val> {
        env.storage().instance().get(&key)
    }

    pub fn instance_set(env: Env, key: StorageKey, value: Val) {
        require_implementation_auth(&env);
        env.storage().instance().set(&key, &value);
    }

    pub fn instance_remove(env: Env, key: StorageKey) {
        require_implementation_auth(&env);
        env.storage().instance().remove(&key);
    }

    pub fn persistent_get(env: Env, key: StorageKey) -> Option<Val> {
        env.storage().persistent().get(&key)
    }

    pub fn persistent_set(env: Env, key: StorageKey, value: Val) {
        require_implementation_auth(&env);
        env.storage().persistent().set(&key, &value);
    }

    pub fn persistent_remove(env: Env, key: StorageKey) {
        require_implementation_auth(&env);
        env.storage().persistent().remove(&key);
    }
}
