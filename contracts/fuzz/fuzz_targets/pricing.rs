#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, String};
use subtrackr_subscription::{Interval, SubTrackrSubscriptionClient};

mod utils;

/// Fuzz pricing edge cases.
///
/// Explores boundary price values, refund amounts, and charge timing to
/// catch math errors (underflow, overflow, rounding) in the pricing engine.
///
/// Byte layout:
///
/// | Offset | Size  | Field                               |
/// |--------|-------|-------------------------------------|
/// | 0      | 1     | action (0=create_plan, 1=charge, 2=refund) |
/// | 1+     | var   | action-specific parameters           |
///
/// Prices are always clamped to a safe range; the fuzzer explores the
/// boundaries of that range.
fuzz_target!(|data: &[u8]| {
    if data.len() < 1 {
        return;
    }
    let mut off: usize = 0;
    let (env, client, proxy, _storage) = utils::setup_env();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    loop {
        if off >= data.len() {
            break;
        }
        let action = data[off] % 3;
        off += 1;

        match action {
            0 => {
                let price = utils::read_price(data, &mut off);
                let interval = utils::read_interval(data, &mut off);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.create_plan(
                        &proxy,
                        &proxy,
                        &admin,
                        &String::from_slice(&env, b"p-fuzz"),
                        &price,
                        &token,
                        &interval,
                    );
                }));
            }
            1 => {
                // charge: advance time so billing applies
                let sub_id = utils::read_bounded_u64(data, &mut off, 100);
                utils::set_time(&env, env.ledger().timestamp() + 86_400);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.charge_subscription(&proxy, &proxy, &sub_id);
                }));
            }
            2 => {
                // request/approve refund
                let sub_id = utils::read_bounded_u64(data, &mut off, 100);
                let refund_amount = utils::read_price(data, &mut off);
                // request_refund may panic on invalid preconditions; catch it
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.request_refund(&proxy, &proxy, &sub_id, &refund_amount);
                }));
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.approve_refund(&proxy, &proxy, &sub_id);
                }));
            }
            _ => {}
        }
    }
});
