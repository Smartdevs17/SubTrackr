//! Storage tiers and TTL helpers shared by SubTrackr contracts.
//!
//! Contract crates keep ownership of their storage keys; this library only
//! provides the accessors and the TTL policy used across them.

use soroban_sdk::{Env, Symbol};

pub const DEFAULT_TTL_THRESHOLD: u32 = 518_400;
pub const DEFAULT_TTL_EXTEND_TO: u32 = 6_311_520;

/// Clamp a caller-supplied TTL to the configured window.
pub fn effective_ttl(requested: u32) -> u32 {
    if requested <= DEFAULT_TTL_THRESHOLD {
        return DEFAULT_TTL_EXTEND_TO;
    }
    requested.min(DEFAULT_TTL_EXTEND_TO)
}

pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(DEFAULT_TTL_THRESHOLD, DEFAULT_TTL_EXTEND_TO);
}

pub fn extend_persistent(env: &Env, key: &Symbol) {
    env.storage()
        .persistent()
        .extend_ttl(key, DEFAULT_TTL_THRESHOLD, DEFAULT_TTL_EXTEND_TO);
}

pub fn extend_temporary(env: &Env, key: &Symbol) {
    env.storage()
        .temporary()
        .extend_ttl(key, DEFAULT_TTL_THRESHOLD, DEFAULT_TTL_EXTEND_TO);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, symbol_short};

    #[contract]
    struct StorageTestContract;

    #[contractimpl]
    impl StorageTestContract {
        pub fn ping(_env: Env) {}
    }

    #[test]
    fn ttl_falls_back_to_the_configured_default() {
        assert_eq!(effective_ttl(0), DEFAULT_TTL_EXTEND_TO);
    }

    #[test]
    fn ttl_is_clamped_to_the_allowed_window() {
        assert_eq!(effective_ttl(1), DEFAULT_TTL_EXTEND_TO);
        assert_eq!(effective_ttl(1_000_000), 1_000_000);
        assert_eq!(effective_ttl(u32::MAX), DEFAULT_TTL_EXTEND_TO);
    }

    #[test]
    fn storage_tiers_can_be_touched() {
        let env = Env::default();
        let id = env.register(StorageTestContract, ());
        let key = symbol_short!("ITEM");
        env.as_contract(&id, || {
            env.storage().persistent().set(&key, &1u32);
            env.storage().temporary().set(&key, &1u32);
            extend_instance(&env);
            extend_persistent(&env, &key);
            extend_temporary(&env, &key);
        });
    }
}
