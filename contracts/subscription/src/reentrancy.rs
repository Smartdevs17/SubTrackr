use soroban_sdk::{Env, Symbol};

const REENTRANCY_KEY: Symbol = soroban_sdk::symbol_short!("R_LOCK");

pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    pub fn new(env: &'a Env) -> Self {
        let is_locked: bool = env.storage().instance().get(&REENTRANCY_KEY).unwrap_or(false);
        if is_locked {
            panic!("Reentrancy detected: Execution locked");
        }
        env.storage().instance().set(&REENTRANCY_KEY, &true);
        Self { env }
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    fn drop(&mut self) {
        self.env.storage().instance().set(&REENTRANCY_KEY, &false);
    }
}