//! Reentrancy guard shared by contracts that call other contracts before
//! finishing their own state updates. The lock lives in instance storage and
//! is always cleared on drop.

use soroban_sdk::{symbol_short, Env, Symbol};

pub const REENTRANCY_KEY: Symbol = symbol_short!("R_LOCK");

pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    /// Acquire the lock, panicking when the current invocation already holds it.
    pub fn acquire(env: &'a Env) -> Self {
        if env.storage().instance().has(&REENTRANCY_KEY) {
            panic!("Reentrancy detected: execution locked");
        }
        env.storage().instance().set(&REENTRANCY_KEY, &true);
        Self { env }
    }

    pub fn is_locked(env: &Env) -> bool {
        env.storage().instance().has(&REENTRANCY_KEY)
    }
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        self.env.storage().instance().remove(&REENTRANCY_KEY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl};

    #[contract]
    struct GuardTestContract;

    #[contractimpl]
    impl GuardTestContract {
        pub fn ping(_env: Env) {}
    }

    #[test]
    fn lock_is_released_when_the_guard_drops() {
        let env = Env::default();
        let id = env.register(GuardTestContract, ());
        env.as_contract(&id, || {
            assert!(!ReentrancyGuard::is_locked(&env));

            {
                let _guard = ReentrancyGuard::acquire(&env);
                assert!(ReentrancyGuard::is_locked(&env));
            }

            assert!(!ReentrancyGuard::is_locked(&env));
        });
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn second_acquire_panics() {
        let env = Env::default();
        let id = env.register(GuardTestContract, ());
        env.as_contract(&id, || {
            let _guard = ReentrancyGuard::acquire(&env);
            let _second = ReentrancyGuard::acquire(&env);
        });
    }
}
