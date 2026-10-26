#![no_main]

mod common;

use common::{assert_subscription_invariants, ignore_expected_panic, plan_name, Harness};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let h = Harness::new();
    let proxy = h.proxy();
    let mut plan_ids = [0u64; 16];
    let mut plan_len = 0usize;
    let mut sub_ids = [0u64; 32];
    let mut sub_len = 0usize;

    for chunk in data.chunks(8).take(64) {
        let op = chunk.get(0).copied().unwrap_or(0) % 8;
        match op {
            0 => {
                let raw_price = u32::from_le_bytes([
                    chunk.get(1).copied().unwrap_or(0),
                    chunk.get(2).copied().unwrap_or(0),
                    chunk.get(3).copied().unwrap_or(0),
                    chunk.get(4).copied().unwrap_or(0),
                ]);
                if let Some(plan_id) = ignore_expected_panic(|| {
                    proxy.create_plan(
                        &h.user(chunk.get(5).copied().unwrap_or(0)),
                        &plan_name(&h.env, chunk.get(6).copied().unwrap_or(0)),
                        &Harness::bounded_price(raw_price),
                        &h.token_id,
                        &Harness::interval(chunk.get(7).copied().unwrap_or(0)),
                    )
                }) {
                    if plan_len < plan_ids.len() {
                        plan_ids[plan_len] = plan_id;
                        plan_len += 1;
                    }
                }
            }
            1 => {
                if plan_len > 0 {
                    let idx = usize::from(chunk.get(1).copied().unwrap_or(0)) % plan_len;
                    if let Some(sub_id) = ignore_expected_panic(|| {
                        proxy.subscribe(&h.user(chunk.get(2).copied().unwrap_or(0)), &plan_ids[idx])
                    }) {
                        if sub_len < sub_ids.len() {
                            sub_ids[sub_len] = sub_id;
                            sub_len += 1;
                        }
                    }
                }
            }
            2 => {
                if sub_len > 0 {
                    let idx = usize::from(chunk.get(1).copied().unwrap_or(0)) % sub_len;
                    let duration = u64::from(chunk.get(2).copied().unwrap_or(0)) * 86_400;
                    let _ = ignore_expected_panic(|| {
                        proxy.pause_by_subscriber(
                            &h.user(chunk.get(3).copied().unwrap_or(0)),
                            &sub_ids[idx],
                            &duration,
                        )
                    });
                }
            }
            3 => {
                if sub_len > 0 {
                    let idx = usize::from(chunk.get(1).copied().unwrap_or(0)) % sub_len;
                    let _ = ignore_expected_panic(|| {
                        proxy.resume_subscription(
                            &h.user(chunk.get(2).copied().unwrap_or(0)),
                            &sub_ids[idx],
                        )
                    });
                }
            }
            4 => {
                if sub_len > 0 {
                    let idx = usize::from(chunk.get(1).copied().unwrap_or(0)) % sub_len;
                    let _ = ignore_expected_panic(|| {
                        proxy.cancel_subscription(
                            &h.user(chunk.get(2).copied().unwrap_or(0)),
                            &sub_ids[idx],
                        )
                    });
                }
            }
            5 => {
                if sub_len > 0 {
                    h.advance_time(u64::from_le_bytes([
                        chunk.get(1).copied().unwrap_or(0),
                        chunk.get(2).copied().unwrap_or(0),
                        chunk.get(3).copied().unwrap_or(0),
                        chunk.get(4).copied().unwrap_or(0),
                        0,
                        0,
                        0,
                        0,
                    ]));
                    let idx = usize::from(chunk.get(5).copied().unwrap_or(0)) % sub_len;
                    let _ = ignore_expected_panic(|| proxy.charge_subscription(&sub_ids[idx]));
                }
            }
            6 => {
                if sub_len > 0 {
                    let idx = usize::from(chunk.get(1).copied().unwrap_or(0)) % sub_len;
                    let amount = i128::from(chunk.get(2).copied().unwrap_or(0));
                    let _ = ignore_expected_panic(|| proxy.request_refund(&sub_ids[idx], &amount));
                }
            }
            _ => {
                if sub_len > 0 {
                    let idx = usize::from(chunk.get(1).copied().unwrap_or(0)) % sub_len;
                    let _ = ignore_expected_panic(|| proxy.approve_refund(&sub_ids[idx]));
                }
            }
        }

        assert_subscription_invariants(&h);
    }
});
