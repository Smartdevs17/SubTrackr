#![allow(dead_code)]
use soroban_sdk::{Address, Env};

pub fn _request_cancellation(_env: &Env, _subscriber: &Address, _subscription_id: u64) {
    // Placeholder — cancellation is handled in subscription_lifecycle.rs
}

pub fn _undo_cancellation(_env: &Env, _subscriber: &Address, _subscription_id: u64) {
    // Placeholder — resumption is handled in subscription_lifecycle.rs
}
