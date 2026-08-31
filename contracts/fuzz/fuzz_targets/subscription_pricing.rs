#![no_main]

mod common;

use common::{assert_subscription_invariants, ignore_expected_panic, plan_name, Harness};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let h = Harness::new();
    let proxy = h.proxy();

    for chunk in data.chunks(12).take(32) {
        let raw_price = u32::from_le_bytes([
            chunk.get(0).copied().unwrap_or(0),
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
            chunk.get(3).copied().unwrap_or(0),
        ]);
        let price = Harness::bounded_price(raw_price);
        let merchant = h.user(chunk.get(4).copied().unwrap_or(0));
        let subscriber = h.user(chunk.get(5).copied().unwrap_or(1));
        let interval = Harness::interval(chunk.get(6).copied().unwrap_or(0));
        let charge_rounds = chunk.get(7).copied().unwrap_or(0) % 4;

        if let Some(plan_id) = ignore_expected_panic(|| {
            proxy.create_plan(
                &merchant,
                &plan_name(&h.env, chunk.get(8).copied().unwrap_or(0)),
                &price,
                &h.token_id,
                &interval,
            )
        }) {
            if let Some(sub_id) = ignore_expected_panic(|| proxy.subscribe(&subscriber, &plan_id)) {
                for round in 0..charge_rounds {
                    h.advance_time(interval.seconds().saturating_add(u64::from(round)));
                    let _ = ignore_expected_panic(|| proxy.charge_subscription(&sub_id));
                }
                let sub = proxy.get_subscription(&sub_id);
                assert!(sub.total_paid >= 0);
                assert!(sub.total_paid <= price.saturating_mul(i128::from(charge_rounds)));
            }
        }

        assert_subscription_invariants(&h);
    }
});
