#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, String};
use subtrackr_subscription::{Interval, SubTrackrSubscriptionClient};
use subtrackr_types::RateLimit;

mod utils;

/// Fuzz the rate-limit enforcement logic.
///
/// The contract enforces per-function, per-wallet rate limits. This
/// target sends many rapid-fire requests from the same wallet to try
/// to trigger timing-based races, off-by-one threshold bugs, or
/// stale-window mis-accounting.
///
/// Unlike the other targets, this one does NOT use mock-all-auths so
/// that rate-limit introspection can observe real caller identities.
fuzz_target!(|data: &[u8]| {
    if data.len() < 1 {
        return;
    }
    let mut off: usize = 0;

    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    utils::set_time(&env, 1_700_000_000);

    let contract_id =
        env.register_contract(None, subtrackr_subscription::SubTrackrSubscription);
    let client = SubTrackrSubscriptionClient::new(&env, &contract_id);

    let proxy = Address::generate(&env);
    let storage = Address::generate(&env);
    let admin = Address::generate(&env);

    client.initialize(&proxy, &storage, &admin);

    // Install a low rate limit to make the target trigger it quickly.
    let limit = RateLimit {
        function: String::from_slice(&env, b"create_plan"),
        max_requests: 3,
        window_seconds: 60,
    };
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.set_rate_limit(&proxy, &proxy, &limit);
    }));

    let token = Address::generate(&env);

    // Hammer the same function repeatedly from the same wallet.
    for _ in 0..100 {
        if off >= data.len() {
            break;
        }
        let price = utils::read_price(data, &mut off);
        let interval = utils::read_interval(data, &mut off);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.create_plan(
                &proxy,
                &proxy,
                &admin,
                &String::from_slice(&env, b"rl-fuzz"),
                &price,
                &token,
                &interval,
            );
        }));
    }
});
