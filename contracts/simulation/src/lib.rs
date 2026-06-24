#![no_std]
use soroban_sdk::{contract, contractimpl, token, Env, Address};

#[contract]
pub struct SimulationHelper;

#[contractimpl]
impl SimulationHelper {
    /// Helper method to safely read state during simulation without mutating it.
    pub fn get_account_balance(env: Env, token_id: Address, account: Address) -> i128 {
        // Read-only access to token balance
        let token = token::Client::new(&env, &token_id);
        token.balance(&account)
    }

    /// Dry-run an allowance check to safely inspect if there's enough allowance
    pub fn check_allowance(env: Env, token_id: Address, owner: Address, spender: Address) -> i128 {
        let token = token::Client::new(&env, &token_id);
        token.allowance(&owner, &spender)
    }
}
