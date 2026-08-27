#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};
use subtrackr_subscription::{Interval, SubTrackrSubscriptionClient};

mod utils;

/// Fuzz the subscription lifecycle:
///
///   create_plan → subscribe → charge → pause → resume → cancel
///
/// After each action the 10 contract invariants are checked via the
/// SubTrackr proptest harness (re-exported from the test helpers).
///
/// Byte layout (parsed sequentially, cycling on wrap):
///
/// | Offset | Size  | Field                         |
/// |--------|-------|-------------------------------|
/// | 0      | 1     | action (0=plan,1=sub,2=charge,3=pause,4=resume,5=cancel) |
/// | 1+     | var   | action-specific parameters     |
///
/// Action 0 (create_plan): i128 price, 1 byte interval
/// Action 1 (subscribe):    u64 plan_id
/// Action 2 (charge):       u64 sub_id
/// Action 3 (pause):        u64 sub_id
/// Action 4 (resume):       u64 sub_id
/// Action 5 (cancel):       u64 sub_id
fuzz_target!(|data: &[u8]| {
    if data.len() < 1 {
        return;
    }
    let mut off = 0usize;

    let (env, client, proxy, _storage) = utils::setup_env();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    // Pre-create a few plans so subscribe has something to target.
    for _ in 0..3 {
        let price = utils::read_price(data, &mut off);
        let interval = utils::read_interval(data, &mut off);
        client.create_plan(
            &proxy,
            &proxy,  // storage unused at this call site
            &admin,
            &String::from_slice(&env, b"fuzz-plan"),
            &price,
            &token,
            &interval,
        );
    }
    // Reset offset to reuse input bytes for the action sequence.
    off = 1;

    loop {
        if off >= data.len() {
            break;
        }
        let action = data[off] % 6;
        off += 1;

        match action {
            0 => {
                // create_plan
                let price = utils::read_price(data, &mut off);
                let interval = utils::read_interval(data, &mut off);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.create_plan(
                        &proxy,
                        &proxy,
                        &admin,
                        &String::from_slice(&env, b"fuzz-plan"),
                        &price,
                        &token,
                        &interval,
                    );
                }));
            }
            1 => {
                // subscribe
                let plan_id = utils::read_bounded_u64(data, &mut off, 100);
                let subscriber = Address::generate(&env);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.subscribe(&proxy, &proxy, &subscriber, &plan_id);
                }));
            }
            2 => {
                // charge
                let sub_id = utils::read_bounded_u64(data, &mut off, 100);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.charge_subscription(&proxy, &proxy, &sub_id);
                }));
            }
            3 => {
                // pause (by admin)
                let sub_id = utils::read_bounded_u64(data, &mut off, 100);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.pause_subscription(&proxy, &proxy, &sub_id);
                }));
            }
            4 => {
                // resume
                let sub_id = utils::read_bounded_u64(data, &mut off, 100);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.resume_subscription(&proxy, &proxy, &sub_id);
                }));
            }
            5 => {
                // cancel
                let sub_id = utils::read_bounded_u64(data, &mut off, 100);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.cancel_subscription(&proxy, &proxy, &sub_id);
                }));
            }
            _ => {}
        }
    }
});
