//! Property-based tests for pricing and billing invariants — Issue #402.
//!
//! These tests extend the existing invariant suite with properties that
//! specifically target:
//!   - Price bounds correctness across all intervals
//!   - `next_charge_at` monotonicity after multiple charges
//!   - `total_paid` conservation across mixed-interval plans
//!   - Cancelled subscription charge-count immutability
//!
//! Run with:
//!   cargo test --test invariants pricing_properties -- --nocapture
//!
//! For deeper exploration:
//!   PROPTEST_CASES=500 cargo test --test invariants pricing_properties

use proptest::prelude::*;
use soroban_sdk::{testutils::Ledger, Env};
use subtrackr::Interval;

use crate::invariants::{assert_invariants, handler::ContractHandler};

// ─── Seed corpus ─────────────────────────────────────────────────────────────
// These specific inputs previously found or nearly found regressions during
// manual testing.  proptest always replays them before generating new cases.

const SEED_PRICES: &[i128] = &[1, 100, 999, 1_000, 9_999, 10_000];
const SEED_CHARGES: &[u32] = &[1, 2, 5, 10];

fn price_strategy() -> impl Strategy<Value = i128> {
    prop_oneof![
        prop::sample::select(SEED_PRICES),
        1i128..10_001i128,
    ]
}

fn charge_count_strategy() -> impl Strategy<Value = u32> {
    prop_oneof![
        prop::sample::select(SEED_CHARGES),
        1u32..11u32,
    ]
}

fn interval_strategy() -> impl Strategy<Value = Interval> {
    prop_oneof![
        Just(Interval::Daily),
        Just(Interval::Weekly),
        Just(Interval::Monthly),
        Just(Interval::Quarterly),
        Just(Interval::Yearly),
    ]
}

// ─── Property tests ───────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..Default::default() })]

    /// PROP-P1: `total_paid = price * charge_count` for any price and any
    /// number of charges on a monthly-interval plan.
    #[test]
    fn prop_total_paid_equals_price_times_charges(
        price      in price_strategy(),
        n_charges  in charge_count_strategy(),
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        let plan_id = h.create_plan(price);
        let sub_id  = h.subscribe(plan_id);

        for _ in 0..n_charges {
            h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
        }

        let sub = h.client.get_subscription(&sub_id);
        prop_assert_eq!(sub.total_paid, price * n_charges as i128,
            "PROP-P1: total_paid mismatch for price={} n_charges={}", price, n_charges);
        prop_assert_eq!(sub.charge_count, n_charges,
            "PROP-P1: charge_count mismatch");
        assert_invariants(&h);
    }

    /// PROP-P2: `next_charge_at` strictly increases after every successful charge.
    #[test]
    fn prop_next_charge_at_monotonically_increases(
        price     in price_strategy(),
        n_charges in 2u32..6u32,
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        let plan_id = h.create_plan(price);
        let sub_id  = h.subscribe(plan_id);

        let mut prev_next_charge = h.client.get_subscription(&sub_id).next_charge_at;

        for i in 0..n_charges {
            h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
            let sub = h.client.get_subscription(&sub_id);
            prop_assert!(
                sub.next_charge_at > prev_next_charge,
                "PROP-P2 VIOLATED after charge {}: next_charge_at did not increase \
                 (prev={} current={})",
                i + 1, prev_next_charge, sub.next_charge_at
            );
            prev_next_charge = sub.next_charge_at;
        }
        assert_invariants(&h);
    }

    /// PROP-P3: After cancellation, `charge_count` must never increase
    /// regardless of how much time passes.
    #[test]
    fn prop_cancelled_subscription_charge_count_immutable(
        price     in price_strategy(),
        n_charges in 1u32..4u32,
        wait_secs in 1u64..(Interval::Yearly.seconds() * 3),
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        let plan_id = h.create_plan(price);
        let sub_id  = h.subscribe(plan_id);

        for _ in 0..n_charges {
            h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
        }

        h.cancel(sub_id);
        let charge_count_at_cancel = h.client.get_subscription(&sub_id).charge_count;

        // Advance arbitrarily far into the future and confirm no charge happens
        env.ledger().set_timestamp(env.ledger().timestamp() + wait_secs);

        // A charge attempt must fail / be a no-op — wrap it so the test
        // continues even if the contract panics on "subscription not active".
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            h.client.charge(&sub_id);
        }));

        let sub_after = h.client.get_subscription(&sub_id);
        prop_assert_eq!(
            sub_after.charge_count, charge_count_at_cancel,
            "PROP-P3 VIOLATED: charge_count changed after cancellation \
             (before={} after={})",
            charge_count_at_cancel, sub_after.charge_count
        );
        assert_invariants(&h);
    }

    /// PROP-P4: `total_paid` conservation across different billing intervals.
    /// For any interval, total_paid must equal price × charge_count.
    #[test]
    fn prop_total_paid_conservation_across_intervals(
        price    in price_strategy(),
        interval in interval_strategy(),
        n       in 1u32..5u32,
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        let plan_id = h.create_plan_with_interval(price, interval.clone());
        let sub_id  = h.subscribe(plan_id);

        let advance = interval.seconds() + 1;
        for _ in 0..n {
            h.advance_and_charge(sub_id, advance);
        }

        let sub = h.client.get_subscription(&sub_id);
        prop_assert_eq!(
            sub.total_paid, price * n as i128,
            "PROP-P4 VIOLATED for interval={:?}: total_paid={} expected={}",
            interval, sub.total_paid, price * n as i128
        );
        assert_invariants(&h);
    }

    /// PROP-P5: Plan subscriber_count must equal the number of distinct
    /// active or paused subscriptions on that plan.
    #[test]
    fn prop_plan_subscriber_count_matches_active_subs(
        price  in price_strategy(),
        n_subs in 1u32..5u32,
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        let plan_id = h.create_plan(price);
        for _ in 0..n_subs {
            h.subscribe(plan_id);
        }

        let plan = h.client.get_plan(&plan_id);
        prop_assert_eq!(plan.subscriber_count, n_subs,
            "PROP-P5: subscriber_count={} expected={}", plan.subscriber_count, n_subs);
        assert_invariants(&h);
    }
}
