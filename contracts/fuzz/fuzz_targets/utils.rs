//! Shared helpers for fuzz targets.
//!
//! Each fuzz target receives raw bytes from libFuzzer. These helpers
//! parse those bytes into structured operations and apply them against
//! the subscription contract.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};
use subtrackr_subscription::{Interval, SubTrackrSubscriptionClient};
use subtrackr_types::StorageKey;

/// Minimum price allowed by the contract (must be > 0).
const MIN_PRICE: i128 = 1;
/// Maximum price that won't cause overflow in intermediate calculations.
const MAX_SAFE_PRICE: i128 = i128::MAX / 1_000_000;

/// Align the ledger timestamp.
pub fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

/// Read a u64 from the byte slice at `offset`.
pub fn read_u64(data: &[u8], offset: &mut usize) -> u64 {
    if *offset + 8 <= data.len() {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&data[*offset..*offset + 8]);
        *offset += 8;
        u64::from_le_bytes(buf)
    } else {
        *offset = data.len();
        0
    }
}

/// Read a bounded u64 from the byte slice.
pub fn read_bounded_u64(data: &[u8], offset: &mut usize, max: u64) -> u64 {
    read_u64(data, offset) % max
}

/// Read an i128 from the byte slice.
pub fn read_i128(data: &[u8], offset: &mut usize) -> i128 {
    if *offset + 16 <= data.len() {
        let mut buf = [0u8; 16];
        buf.copy_from_slice(&data[*offset..*offset + 16]);
        *offset += 16;
        i128::from_le_bytes(buf)
    } else {
        *offset = data.len();
        0
    }
}

/// Read a price in [MIN_PRICE, MAX_SAFE_PRICE].
pub fn read_price(data: &[u8], offset: &mut usize) -> i128 {
    let raw = read_i128(data, offset);
    let bounded = raw.unsigned_abs() as i128;
    if bounded < MIN_PRICE {
        MIN_PRICE
    } else if bounded > MAX_SAFE_PRICE {
        MAX_SAFE_PRICE
    } else {
        bounded
    }
}

/// Read an Interval from the byte slice.
pub fn read_interval(data: &[u8], offset: &mut usize) -> Interval {
    match read_u64(data, offset) % 4 {
        0 => Interval::Daily,
        1 => Interval::Weekly,
        2 => Interval::Monthly,
        _ => Interval::Yearly,
    }
}

/// Bootstrap a fresh environment with a registered subscription contract,
/// mock auths, and predefined admin/merchant.
pub fn setup_env() -> (Env, SubTrackrSubscriptionClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    set_time(&env, 1_700_000_000);

    let contract_id = env.register_contract(
        None,
        subtrackr_subscription::SubTrackrSubscription,
    );
    let client = SubTrackrSubscriptionClient::new(&env, &contract_id);

    let proxy = Address::generate(&env);
    let storage = Address::generate(&env);
    let admin = Address::generate(&env);

    client.initialize(&proxy, &storage, &admin);

    (env, client, proxy, storage)
}
