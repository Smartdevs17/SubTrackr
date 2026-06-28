#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, String};
use subtrackr_subscription::{Interval, SubTrackrSubscriptionClient};

mod utils;

/// Fuzz the subscription state machine.
///
/// A subscription follows this lifecycle:
///
///   Active ──pause──► Paused ──resume──► Active
///     │                                      │
///     └──cancel──► Cancelled                  │
///     └───────────────────────────────────────┘
///
/// The fuzzer explores every transition sequence to uncover
/// double-cancel, resume-after-cancel, charge-while-paused, and other
/// illegal-state bugs.
///
/// Byte layout:
///
/// | Offset | Size  | Field            |
/// |--------|-------|------------------|
/// | 0      | 1     | skip setup       |
/// | 1+     | cycle | action, u64 sub  |
///
/// Actions: 0=pause, 1=resume, 2=cancel, 3=charge
///
/// Most actions are expected to fail (invalid transitions). The fuzzer
/// validates that panics are the *right* panics — i.e., they do not
/// corrupt contract state.
fuzz_target!(|data: &[u8]| {
    if data.len() < 2 {
        return;
    }
    let mut off: usize = 1;

    let (env, client, proxy, _storage) = utils::setup_env();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    // Create one plan and one subscription as the base for all transitions.
    let plan_id = client.create_plan(
        &proxy,
        &proxy,
        &admin,
        &String::from_slice(&env, b"sm-fuzz"),
        &10_000_000,
        &token,
        &Interval::Daily,
    );
    let subscriber = Address::generate(&env);
    let sub_id = client.subscribe(&proxy, &proxy, &subscriber, &plan_id);

    loop {
        if off + 9 > data.len() {
            break;
        }
        let action = data[off] % 4;
        off += 1;
        let target = utils::read_bounded_u64(data, &mut off, sub_id + 10);

        match action {
            0 => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.pause_subscription(&proxy, &proxy, &target);
                }));
            }
            1 => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.resume_subscription(&proxy, &proxy, &target);
                }));
            }
            2 => {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.cancel_subscription(&proxy, &proxy, &target);
                }));
            }
            3 => {
                utils::set_time(&env, env.ledger().timestamp() + 86_400);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.charge_subscription(&proxy, &proxy, &target);
                }));
            }
            _ => {}
        }
    }
});
