// Regression replay harness for subscription-contract fuzzing (issue #1806).
//
// libFuzzer (`cargo-fuzz`, nightly-only) discovers crashing inputs during
// long fuzz runs. `contracts/fuzz/scripts/triage-crash.sh` copies each crash
// artifact into `contracts/subscription/tests/regressions/<target>_<sha>.bin`.
//
// This file turns those artifacts into **deterministic, stable-toolchain
// `cargo test` cases** so that:
//
//   1. Failures are reproducible — every crash file is replayed on every CI
//      run and locally with `cargo test` (no nightly/libfuzzer required).
//   2. Regressions are guarded — a crash that was fixed can never silently
//      come back without this test failing on the offending `.bin`.
//   3. Iterations are configurable — `FUZZ_REGRESSION_ITERATIONS` controls
//      the number of in-process pseudo-random inputs replayed from a fixed
//      seed, giving a fast, deterministic fuzz smoke that runs in CI.
//
// Run locally:
//
//   cargo test --manifest-path contracts/subscription/Cargo.toml \
//       --test fuzz_regressions
//
// Configurable iterations (default 64):
//
//   FUZZ_REGRESSION_ITERATIONS=4096 cargo test --test fuzz_regressions -- --nocapture

#![allow(deprecated)] // env.register_contract(..) deprecation

use std::path::PathBuf;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, SubscriptionStatus};

const START_TS: u64 = 1_700_000_000;
const USER_COUNT: usize = 8;

// ─── Harness (mirrors contracts/fuzz/fuzz_targets/common.rs) ────────────────

struct Harness {
    env: Env,
    proxy_id: Address,
    token_id: Address,
    users: [Address; USER_COUNT],
}

impl Harness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_timestamp(START_TS);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let users = core::array::from_fn(|_| Address::generate(&env));

        let storage_id = env.register_contract(None, SubTrackrStorage);
        let implementation_id = env.register_contract(None, SubTrackrSubscription);
        let proxy_id = env.register_contract(None, UpgradeableProxy);
        let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
        proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_id = token_contract.address();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        for user in users.iter() {
            token_admin_client.mint(user, &10_000_000_000);
        }

        Self {
            env,
            proxy_id,
            token_id,
            users,
        }
    }

    fn proxy(&self) -> UpgradeableProxyClient<'_> {
        UpgradeableProxyClient::new(&self.env, &self.proxy_id)
    }

    fn user(&self, raw: u8) -> Address {
        self.users[usize::from(raw) % USER_COUNT].clone()
    }

    fn interval(raw: u8) -> Interval {
        match raw % 5 {
            0 => Interval::Daily,
            1 => Interval::Weekly,
            2 => Interval::Monthly,
            3 => Interval::Quarterly,
            _ => Interval::Yearly,
        }
    }

    fn bounded_price(raw: u32) -> i128 {
        i128::from(raw % 1_000_000).saturating_add(1)
    }

    fn advance_time(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env
            .ledger()
            .set_timestamp(now.saturating_add(secs % (Interval::Yearly.seconds() * 2)));
    }
}

fn ignore_expected_panic<T>(f: impl FnOnce() -> T) -> Option<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok()
}

fn plan_name(env: &Env, byte: u8) -> String {
    match byte % 4 {
        0 => String::from_str(env, "basic"),
        1 => String::from_str(env, "pro"),
        2 => String::from_str(env, "team"),
        _ => String::from_str(env, "enterprise"),
    }
}

fn assert_subscription_invariants(h: &Harness) {
    let proxy = h.proxy();
    let plan_count = proxy.get_plan_count();
    let sub_count = proxy.get_subscription_count();

    let mut plan_id = 1u64;
    while plan_id <= plan_count.min(32) {
        let plan = proxy.get_plan(&plan_id);
        assert!(plan.price > 0);
        assert!(plan.created_at >= START_TS);
        plan_id += 1;
    }

    let mut sub_id = 1u64;
    while sub_id <= sub_count.min(32) {
        let sub = proxy.get_subscription(&sub_id);
        assert!(sub.next_charge_at >= sub.started_at);
        assert!(sub.total_paid >= 0);
        assert!(sub.refund_requested_amount >= 0);
        assert!(sub.refund_requested_amount <= sub.total_paid);
        match sub.status {
            SubscriptionStatus::Active
            | SubscriptionStatus::Paused
            | SubscriptionStatus::Cancelled
            | SubscriptionStatus::PastDue => {}
        }
        sub_id += 1;
    }
}

// ─── Replay (mirrors contracts/fuzz/fuzz_targets/subscription_lifecycle.rs) ─

/// Replay the subscription-lifecycle fuzz target against `data`.
///
/// After every operation the contract invariants are re-checked. A panic
/// here means the input corrupts contract state — i.e. a real bug.
fn replay_lifecycle(data: &[u8]) {
    let h = Harness::new();
    let proxy = h.proxy();
    let mut plan_ids = [0u64; 16];
    let mut plan_len = 0usize;
    let mut sub_ids = [0u64; 32];
    let mut sub_len = 0usize;

    for chunk in data.chunks(8).take(64) {
        let op = chunk.first().copied().unwrap_or(0) % 8;
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
}

// ─── Deterministic in-process fuzzer (configurable iterations) ──────────────

/// SplitMix64 — tiny, deterministic PRNG so replay inputs are reproducible
/// from a fixed seed without pulling in a rand crate.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_1155);
        z ^ (z >> 31)
    }

    fn fill_bytes(&mut self, out: &mut [u8]) {
        let mut i = 0;
        while i + 8 <= out.len() {
            let v = self.next_u64();
            out[i..i + 8].copy_from_slice(&v.to_le_bytes());
            i += 8;
        }
        if i < out.len() {
            let v = self.next_u64();
            let remaining = out.len() - i;
            out[i..].copy_from_slice(&v.to_le_bytes()[..remaining]);
        }
    }
}

fn iterations() -> usize {
    std::env::var("FUZZ_REGRESSION_ITERATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n: &usize| n > 0)
        .unwrap_or(64)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[test]
fn replay_known_corpus_seeds() {
    // A handful of hand-crafted seeds exercising the main lifecycle paths.
    // These double as a smoke test for the replay harness itself.
    let seeds: &[&[u8]] = &[
        // create plan (op 0)
        &[0, 10, 0, 0, 0, 0, 1, 2],
        // create plan then subscribe (op 1)
        &[0, 50, 0, 0, 0, 1, 0, 2, 1, 0, 2, 0, 0, 0, 0, 0],
        // create → subscribe → charge (op 5)
        &[
            0, 100, 0, 0, 0, 2, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 5, 30, 0, 0, 0, 0, 0, 0,
        ],
        // create → subscribe → pause (op 2) → resume (op 3)
        &[
            0, 5, 0, 0, 0, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 7, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0,
            0, 0, 0,
        ],
        // create → subscribe → cancel (op 4)
        &[
            0, 7, 0, 0, 0, 4, 3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0,
        ],
    ];

    for (i, seed) in seeds.iter().enumerate() {
        // Each seed must replay without panicking or violating invariants.
        replay_lifecycle(seed);
        // Touch i so we exercise each seed distinctly in error output.
        let _ = i;
    }
}

#[test]
fn deterministic_in_process_fuzz_configurable_iterations() {
    // Deterministic, seed-based fuzz run. The iteration count is
    // configurable via FUZZ_REGRESSION_ITERATIONS (default 64), making this
    // a fast, reproducible fuzz smoke that runs in CI on the stable toolchain.
    let n = iterations();
    let mut rng = SplitMix64(0xA17C_5EED_CA7E_BEEF); // fixed seed
    let mut buf = [0u8; 512];

    for iter in 0..n {
        // Vary the length so different action-stream shapes are explored.
        let len = 16 + (rng.next_u64() as usize % (buf.len() - 16));
        rng.fill_bytes(&mut buf[..len]);
        replay_lifecycle(&buf[..len]);
        // Guard against the compiler eliding the loop.
        let _ = iter;
    }
}

#[test]
fn replay_crash_artifacts_from_regressions_dir() {
    // Replay every crash artifact that triage-crash.sh has recorded under
    // contracts/subscription/tests/regressions/. When the directory is empty
    // (no crashes found yet) this test is a no-op pass. As soon as a crash is
    // promoted, it becomes a permanent regression guard.
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dir.push("tests");
    dir.push("regressions");

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => {
            // No regressions directory yet — nothing to replay.
            return;
        }
    };

    let mut replayed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bin") {
            continue;
        }
        let data = std::fs::read(&path)
            .unwrap_or_else(|e| panic!("read regression {}: {e}", path.display()));
        // A previously-crashing input must now replay cleanly. If it panics
        // here, a regression has been reintroduced.
        replay_lifecycle(&data);
        replayed += 1;
    }

    eprintln!(
        "replayed {replayed} crash artifact(s) from {}",
        dir.display()
    );
}
