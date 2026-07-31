#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct CurrencyOracle;

#[contractimpl]
impl CurrencyOracle {
    pub fn get_rate(env: Env, from: Symbol, to: Symbol) -> u32 {
        // Mock implementation for test purposes
        // Returns rate scaled by 1000 (e.g. 1.1 becomes 1100)
        1100
    }
}
