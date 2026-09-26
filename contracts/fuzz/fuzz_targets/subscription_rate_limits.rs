#![no_main]

mod common;

use common::{assert_subscription_invariants, ignore_expected_panic, plan_name, Harness};
use libfuzzer_sys::fuzz_target;
use soroban_sdk::String;

fuzz_target!(|data: &[u8]| {
    let h = Harness::new();
    let proxy = h.proxy();
    let merchant = h.user(data.get(0).copied().unwrap_or(0));
    let min_interval = u64::from(data.get(1).copied().unwrap_or(0));

    let _ = ignore_expected_panic(|| {
        proxy.set_rate_limit(&String::from_str(&h.env, "create_plan"), &min_interval)
    });

    for chunk in data.get(2..).unwrap_or_default().chunks(6).take(32) {
        let price = Harness::bounded_price(u32::from_le_bytes([
            chunk.get(0).copied().unwrap_or(0),
            chunk.get(1).copied().unwrap_or(0),
            0,
            0,
        ]));
        let _ = ignore_expected_panic(|| {
            proxy.create_plan(
                &merchant,
                &plan_name(&h.env, chunk.get(2).copied().unwrap_or(0)),
                &price,
                &h.token_id,
                &Harness::interval(chunk.get(3).copied().unwrap_or(0)),
            )
        });
        h.advance_time(u64::from(chunk.get(4).copied().unwrap_or(0)));
        assert_subscription_invariants(&h);
    }
});
