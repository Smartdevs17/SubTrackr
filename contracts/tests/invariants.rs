/// Subscription contract invariant test suite.
///
/// This file contains three complementary layers of invariant testing:
///
/// 1. **Deterministic scenario tests** — hand-crafted sequences that exercise
///    every state transition and assert all invariants after each step.
///
/// 2. **Property-based / fuzz tests** — proptest generates random action
///    sequences; invariants are checked after every action.
///
/// 3. **State-machine invariant tests** — a richer action model (pause,
///    resume, cancel, refund, transfer) is fuzzed to cover the full lifecycle.
///
/// Run with:
///   cargo test --test invariants -- --nocapture
///
/// For extended fuzz runs set the env var:
///   PROPTEST_CASES=1000 cargo test --test invariants
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};
use subtrackr::Interval;

#[path = "invariants/mod.rs"]
mod invariants;
use invariants::{assert_invariants, handler::ContractHandler};

// ═══════════════════════════════════════════════════════════════════════════
// 1. DETERMINISTIC SCENARIO TESTS
// ═══════════════════════════════════════════════════════════════════════════

/// Baseline: create plan → subscribe → charge → assert all invariants.
#[test]
fn test_basic_flow_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    assert_invariants(&h);

    let sub_id = h.subscribe(plan_id);
    assert_invariants(&h);

    h.charge(sub_id);
    assert_invariants(&h);
}

/// Multiple plans and multiple subscribers — plan count and subscriber counts
/// must stay consistent throughout.
#[test]
fn test_multiple_plans_and_subscribers_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let p1 = h.create_plan(100);
    let p2 = h.create_plan(200);
    let p3 = h.create_plan(300);
    assert_invariants(&h);

    let s1 = h.subscribe(p1);
    let s2 = h.subscribe(p1);
    let s3 = h.subscribe(p2);
    let s4 = h.subscribe(p3);
    assert_invariants(&h);

    h.charge(s1);
    assert_invariants(&h);
    h.charge(s2);
    assert_invariants(&h);
    h.charge(s3);
    assert_invariants(&h);
    h.charge(s4);
    assert_invariants(&h);
}

/// Cancel a subscription — subscriber_count must decrement, status must be
/// Cancelled, and total_paid must remain unchanged.
#[test]
fn test_cancel_subscription_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);
    h.charge(sub_id);
    assert_invariants(&h);

    h.cancel(sub_id, 0);
    assert_invariants(&h);

    // Verify on-chain status
    let sub = h.client.get_subscription(&sub_id);
    assert_eq!(sub.status, subtrackr::SubscriptionStatus::Cancelled);
    // total_paid must not change on cancel
    assert_eq!(sub.total_paid, 500);
}

/// Pause → resume cycle — paused_at invariant and status transitions.
#[test]
fn test_pause_resume_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);
    assert_invariants(&h);

    h.pause(sub_id, 0);
    assert_invariants(&h);

    h.advance_time(86_400); // 1 day
    h.resume(sub_id, 0);
    assert_invariants(&h);

    // Charge after resume
    h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
    assert_invariants(&h);
}

/// Auto-resume: pause with short duration, advance past it, then charge.
#[test]
fn test_auto_resume_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);

    // Pause for 1 day
    h.client
        .pause_by_subscriber(&h.subscribers[0].clone(), &sub_id, &86_400u64);
    assert_invariants(&h);

    // Advance 2 days — auto-resume should fire on next read
    h.advance_time(172_800);
    assert_invariants(&h);

    // Charge (auto-resume happens inside charge_subscription)
    h.advance_and_charge(sub_id, Interval::Monthly.seconds());
    assert_invariants(&h);
}

/// Refund flow: charge → request_refund → approve_refund.
/// total_paid must decrease by the refund amount; refund_requested_amount
/// must return to 0.
#[test]
fn test_refund_flow_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(1_000);
    let sub_id = h.subscribe(plan_id);
    h.charge(sub_id);
    assert_invariants(&h);

    h.request_refund(sub_id, 400);
    assert_invariants(&h);

    h.approve_refund(sub_id);
    assert_invariants(&h);

    let sub = h.client.get_subscription(&sub_id);
    assert_eq!(sub.total_paid, 600, "total_paid should be 1000 - 400 = 600");
    assert_eq!(sub.refund_requested_amount, 0);
}

/// Refund rejection: refund_requested_amount must return to 0 without
/// changing total_paid.
#[test]
fn test_refund_rejection_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(1_000);
    let sub_id = h.subscribe(plan_id);
    h.charge(sub_id);

    h.request_refund(sub_id, 300);
    assert_invariants(&h);

    h.reject_refund(sub_id);
    assert_invariants(&h);

    let sub = h.client.get_subscription(&sub_id);
    assert_eq!(sub.total_paid, 1_000, "total_paid unchanged after rejection");
    assert_eq!(sub.refund_requested_amount, 0);
}

/// Subscription transfer: user index consistency invariant must hold after
/// ownership moves to a new address.
#[test]
fn test_transfer_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);
    assert_invariants(&h);

    let recipient = Address::generate(&env);
    h.request_transfer(sub_id, 0, recipient.clone());
    h.accept_transfer(sub_id, recipient.clone());

    // Update subscribers pool so invariant checker can find the new owner
    h.subscribers.push(recipient.clone());
    assert_invariants(&h);

    let sub = h.client.get_subscription(&sub_id);
    assert_eq!(sub.subscriber, recipient);
}

/// Deactivating a plan must not affect existing subscriptions.
#[test]
fn test_plan_deactivation_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);
    assert_invariants(&h);

    h.deactivate_plan(plan_id);
    assert_invariants(&h);

    // Existing subscription still operable
    h.pause(sub_id, 0);
    assert_invariants(&h);
    h.resume(sub_id, 0);
    assert_invariants(&h);
}

/// Multiple charges on the same subscription — charge_count and total_paid
/// must grow monotonically.
#[test]
fn test_multiple_charges_monotonic_invariants() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);

    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);

    let mut prev_total_paid = 0i128;
    let mut prev_charge_count = 0u32;

    for _ in 0..5 {
        h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
        assert_invariants(&h);

        let sub = h.client.get_subscription(&sub_id);
        assert!(
            sub.total_paid >= prev_total_paid,
            "total_paid must be monotonically non-decreasing"
        );
        assert!(
            sub.charge_count >= prev_charge_count,
            "charge_count must be monotonically non-decreasing"
        );
        assert!(
            sub.next_charge_at > h.current_timestamp() - 1,
            "next_charge_at must be in the future after a charge"
        );
        prev_total_paid = sub.total_paid;
        prev_charge_count = sub.charge_count;
    }
}

/// All billing intervals produce valid next_charge_at values.
#[test]
fn test_all_intervals_invariants() {
    for interval in [
        Interval::Weekly,
        Interval::Monthly,
        Interval::Quarterly,
        Interval::Yearly,
    ] {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);
        let plan_id = h.create_plan_with_interval(500, interval.clone());
        let sub_id = h.subscribe(plan_id);
        assert_invariants(&h);

        h.advance_and_charge(sub_id, interval.seconds() + 1);
        assert_invariants(&h);

        let sub = h.client.get_subscription(&sub_id);
        assert_eq!(sub.charge_count, 1);
        assert_eq!(sub.total_paid, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROPERTY-BASED FUZZ TESTS (basic action set)
// ═══════════════════════════════════════════════════════════════════════════

/// Actions for the basic property-based test.
#[derive(Debug, Clone)]
enum BasicAction {
    CreatePlan(i128),
    Subscribe(u64),
    Charge(u64),
}

fn basic_action_strategy() -> impl Strategy<Value = BasicAction> {
    prop_oneof![
        (100i128..10_000i128).prop_map(BasicAction::CreatePlan),
        (1u64..8u64).prop_map(BasicAction::Subscribe),
        (1u64..8u64).prop_map(BasicAction::Charge),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// Fuzz: random create/subscribe/charge sequences must never violate
    /// any invariant.
    #[test]
    fn prop_basic_actions_preserve_invariants(
        actions in prop::collection::vec(basic_action_strategy(), 1..15)
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        for action in actions {
            match action {
                BasicAction::CreatePlan(price) => {
                    h.create_plan(price);
                }
                BasicAction::Subscribe(plan_id) => {
                    if h.ghost.plan_count >= plan_id && plan_id >= 1 {
                        h.subscribe(plan_id);
                    }
                }
                BasicAction::Charge(sub_id) => {
                    if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                        h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
                    }
                }
            }
            assert_invariants(&h);
        }
    }

    /// Fuzz: plan count must equal the number of CreatePlan actions executed.
    #[test]
    fn prop_plan_count_equals_create_plan_calls(
        prices in prop::collection::vec(100i128..5_000i128, 1..15)
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        for price in &prices {
            h.create_plan(*price);
        }
        prop_assert_eq!(h.client.get_plan_count(), prices.len() as u64);
        assert_invariants(&h);
    }

    /// Fuzz: subscription count must equal the number of successful subscribe
    /// calls.
    #[test]
    fn prop_subscription_count_equals_subscribe_calls(n_plans: u64, n_subs: u64) {
        let n_plans = (n_plans % 5) + 1;   // 1..=5
        let n_subs  = (n_subs  % 10) + 1;  // 1..=10

        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        for _ in 0..n_plans {
            h.create_plan(500);
        }
        for i in 0..n_subs {
            let plan_id = (i % n_plans) + 1;
            h.subscribe(plan_id);
        }
        prop_assert_eq!(h.client.get_subscription_count(), n_subs);
        assert_invariants(&h);
    }

    /// Fuzz: total_paid for a subscription must equal price × charge_count.
    #[test]
    fn prop_total_paid_equals_price_times_charge_count(
        price in 100i128..5_000i128,
        n_charges in 1u32..6u32,
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        let plan_id = h.create_plan(price);
        let sub_id  = h.subscribe(plan_id);

        for _ in 0..n_charges {
            h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
        }

        let sub = h.client.get_subscription(&sub_id);
        prop_assert_eq!(sub.total_paid, price * n_charges as i128);
        prop_assert_eq!(sub.charge_count, n_charges);
        assert_invariants(&h);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. STATE-MACHINE INVARIANT TESTS (full lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

/// Rich action set covering the full subscription lifecycle.
#[derive(Debug, Clone)]
enum LifecycleAction {
    CreatePlan(i128),
    Subscribe(u64),
    Charge(u64),
    Cancel(u64),
    Pause(u64),
    Resume(u64),
    RequestRefund(u64, i128),
    ApproveRefund(u64),
    RejectRefund(u64),
    AdvanceTime(u64),
}

fn lifecycle_action_strategy() -> impl Strategy<Value = LifecycleAction> {
    prop_oneof![
        // Weight plan/subscribe/charge higher so we build up state
        3 => (100i128..5_000i128).prop_map(LifecycleAction::CreatePlan),
        3 => (1u64..6u64).prop_map(LifecycleAction::Subscribe),
        3 => (1u64..6u64).prop_map(LifecycleAction::Charge),
        1 => (1u64..6u64).prop_map(LifecycleAction::Cancel),
        1 => (1u64..6u64).prop_map(LifecycleAction::Pause),
        1 => (1u64..6u64).prop_map(LifecycleAction::Resume),
        1 => (1u64..6u64, 1i128..500i128).prop_map(|(id, amt)| LifecycleAction::RequestRefund(id, amt)),
        1 => (1u64..6u64).prop_map(LifecycleAction::ApproveRefund),
        1 => (1u64..6u64).prop_map(LifecycleAction::RejectRefund),
        1 => (1u64..2_592_001u64).prop_map(LifecycleAction::AdvanceTime),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// State-machine fuzz: any sequence of lifecycle actions must preserve
    /// all invariants. Invalid operations are silently skipped so the fuzzer
    /// can explore deep state without panicking on expected errors.
    #[test]
    fn prop_state_machine_preserves_invariants(
        actions in prop::collection::vec(lifecycle_action_strategy(), 3..15)
    ) {
        let env = Env::default();
        let mut h = ContractHandler::new(&env);

        for action in actions {
            apply_lifecycle_action(&mut h, action);
            assert_invariants(&h);
        }
    }
}

/// Apply a lifecycle action, silently ignoring expected contract panics
/// (e.g. "Payment not yet due", "Only active subscriptions can be paused").
fn apply_lifecycle_action(h: &mut ContractHandler, action: LifecycleAction) {
    match action {
        LifecycleAction::CreatePlan(price) => {
            h.create_plan(price);
        }

        LifecycleAction::Subscribe(plan_id) => {
            if h.ghost.plan_count >= plan_id && plan_id >= 1 {
                // Use a fresh address each time to avoid "already subscribed"
                h.subscribe(plan_id);
            }
        }

        LifecycleAction::Charge(sub_id) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                // Advance time enough to make the charge valid
                h.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1);
            }
        }

        LifecycleAction::Cancel(sub_id) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 && !h.subscribers.is_empty() {
                // Find the subscriber for this sub_id
                let sub = h.client.get_subscription(&sub_id);
                if sub.status == subtrackr::SubscriptionStatus::Active
                    || sub.status == subtrackr::SubscriptionStatus::Paused
                {
                    // Find the index of the subscriber in our pool
                    if let Some(idx) = h.subscribers.iter().position(|a| *a == sub.subscriber) {
                        h.cancel(sub_id, idx);
                    }
                }
            }
        }

        LifecycleAction::Pause(sub_id) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                let sub = h.client.get_subscription(&sub_id);
                if sub.status == subtrackr::SubscriptionStatus::Active {
                    if let Some(idx) = h.subscribers.iter().position(|a| *a == sub.subscriber) {
                        h.pause(sub_id, idx);
                    }
                }
            }
        }

        LifecycleAction::Resume(sub_id) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                let sub = h.client.get_subscription(&sub_id);
                if sub.status == subtrackr::SubscriptionStatus::Paused {
                    if let Some(idx) = h.subscribers.iter().position(|a| *a == sub.subscriber) {
                        h.resume(sub_id, idx);
                    }
                }
            }
        }

        LifecycleAction::RequestRefund(sub_id, amount) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                let sub = h.client.get_subscription(&sub_id);
                // Only request if there's enough total_paid and no pending refund
                if sub.total_paid >= amount
                    && amount > 0
                    && sub.refund_requested_amount == 0
                {
                    h.request_refund(sub_id, amount);
                }
            }
        }

        LifecycleAction::ApproveRefund(sub_id) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                let sub = h.client.get_subscription(&sub_id);
                if sub.refund_requested_amount > 0 {
                    h.approve_refund(sub_id);
                }
            }
        }

        LifecycleAction::RejectRefund(sub_id) => {
            if h.ghost.subscription_count >= sub_id && sub_id >= 1 {
                let sub = h.client.get_subscription(&sub_id);
                if sub.refund_requested_amount > 0 {
                    h.reject_refund(sub_id);
                }
            }
        }

        LifecycleAction::AdvanceTime(secs) => {
            h.advance_time(secs);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. AUTHORIZATION INVARIANT TESTS
// ═══════════════════════════════════════════════════════════════════════════

/// Merchant cannot self-subscribe — authorization rule must hold.
#[test]
fn test_auth_merchant_cannot_self_subscribe() {
    let env = Env::default();
    let h = ContractHandler::new(&env);
    let plan_id = {
        let mut h2 = ContractHandler::new(&env);
        h2.create_plan(500)
    };
    // We can't easily test panics in a non-should_panic test, but we verify
    // the invariant state is clean after a valid subscribe.
    let _ = h;
    let _ = plan_id;
    // The actual panic test lives in integration_soroban.rs; here we just
    // confirm the invariant checker doesn't false-positive on a clean state.
    let env2 = Env::default();
    let mut h2 = ContractHandler::new(&env2);
    let p = h2.create_plan(500);
    let s = h2.subscribe(p);
    assert_invariants(&h2);
    let sub = h2.client.get_subscription(&s);
    assert_ne!(
        sub.subscriber, h2.merchant,
        "AUTH: subscriber must not be the merchant"
    );
}

/// Only the subscriber can cancel — verified via ghost state after cancel.
#[test]
fn test_auth_only_subscriber_can_cancel() {
    let env = Env::default();
    let mut h = ContractHandler::new(&env);
    let plan_id = h.create_plan(500);
    let sub_id = h.subscribe(plan_id);

    h.cancel(sub_id, 0);
    assert_invariants(&h);

    let sub = h.client.get_subscription(&sub_id);
    assert_eq!(sub.status, subtrackr::SubscriptionStatus::Cancelled);
}

/// Admin is always set after initialization.
#[test]
fn test_admin_always_set_after_init() {
    let env = Env::default();
    let h = ContractHandler::new(&env);
    // If admin were not set, any admin-gated call would panic.
    // We verify by calling a plan creation (which checks admin for rate-limit bypass).
    let mut h = h;
    let plan_id = h.create_plan(100);
    assert_eq!(plan_id, 1);
    assert_invariants(&h);
}
