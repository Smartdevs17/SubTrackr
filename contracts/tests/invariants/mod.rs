/// Invariant definitions for the SubTrackr subscription contract.
///
/// # Invariants documented here
///
/// | # | Name                          | Description                                                                 |
/// |---|-------------------------------|-----------------------------------------------------------------------------|
/// | 1 | PlanCountMonotonic            | `get_plan_count()` equals the ghost plan counter and never decreases.       |
/// | 2 | SubscriptionCountMonotonic    | `get_subscription_count()` equals the ghost sub counter and never decreases.|
/// | 3 | TotalPaidConservation         | Each subscription's `total_paid` equals the sum of all successful charges   |
/// |   |                               | minus approved refunds tracked by the ghost model.                          |
/// | 4 | PlanSubscriberCountAccuracy   | `plan.subscriber_count` matches the ghost count of active/paused subs.      |
/// | 5 | PausedAtNonZeroWhenPaused     | If `status == Paused` then `paused_at > 0`.                                 |
/// | 6 | CancelledSubNotChargeable     | A cancelled subscription's `next_charge_at` is never in the future          |
/// |   |                               | relative to when it was cancelled (charge_count must not increase).         |
/// | 7 | RefundAmountBounded           | `refund_requested_amount <= total_paid` for every subscription.             |
/// | 8 | NextChargeAtMonotonic         | After a successful charge `next_charge_at` strictly increases.              |
/// | 9 | TotalCollectedNonNegative     | Ghost `total_collected` is always >= 0.                                     |
/// |10 | UserSubsIndexConsistency      | Every sub_id in `get_user_subscriptions` resolves to a real subscription    |
/// |   |                               | whose `subscriber` field matches the queried address.                       |
pub mod handler;

use handler::ContractHandler;
use subtrackr::SubscriptionStatus;

/// Assert all invariants against the current contract + ghost state.
///
/// Call this after every state-mutating operation in tests.
pub fn assert_invariants(handler: &ContractHandler) {
    invariant_plan_count_monotonic(handler);
    invariant_subscription_count_monotonic(handler);
    invariant_total_paid_conservation(handler);
    invariant_plan_subscriber_count_accuracy(handler);
    invariant_paused_at_nonzero_when_paused(handler);
    invariant_refund_amount_bounded(handler);
    invariant_total_collected_nonnegative(handler);
    invariant_user_subs_index_consistency(handler);
}

// ── Individual invariant functions ───────────────────────────────────────────

/// INV-1: Plan count reported by the contract equals the ghost counter.
fn invariant_plan_count_monotonic(handler: &ContractHandler) {
    let on_chain = handler.client.get_plan_count();
    assert_eq!(
        on_chain, handler.ghost.plan_count,
        "INV-1 VIOLATED: plan count on-chain ({on_chain}) != ghost ({})",
        handler.ghost.plan_count
    );
}

/// INV-2: Subscription count reported by the contract equals the ghost counter.
fn invariant_subscription_count_monotonic(handler: &ContractHandler) {
    let on_chain = handler.client.get_subscription_count();
    assert_eq!(
        on_chain, handler.ghost.subscription_count,
        "INV-2 VIOLATED: subscription count on-chain ({on_chain}) != ghost ({})",
        handler.ghost.subscription_count
    );
}

/// INV-3: Each subscription's on-chain `total_paid` matches the ghost model.
fn invariant_total_paid_conservation(handler: &ContractHandler) {
    for (&sub_id, &ghost_paid) in &handler.ghost.sub_total_paid {
        let sub = handler.client.get_subscription(&sub_id);
        assert_eq!(
            sub.total_paid, ghost_paid,
            "INV-3 VIOLATED: sub {sub_id} total_paid on-chain ({}) != ghost ({ghost_paid})",
            sub.total_paid
        );
        // total_paid must never be negative
        assert!(
            sub.total_paid >= 0,
            "INV-3 VIOLATED: sub {sub_id} total_paid is negative ({})",
            sub.total_paid
        );
    }
}

/// INV-4: Plan subscriber_count matches the ghost count of non-cancelled subs.
fn invariant_plan_subscriber_count_accuracy(handler: &ContractHandler) {
    for (&plan_id, &ghost_count) in &handler.ghost.plan_subscriber_count {
        let plan = handler.client.get_plan(&plan_id);
        assert_eq!(
            plan.subscriber_count, ghost_count,
            "INV-4 VIOLATED: plan {plan_id} subscriber_count on-chain ({}) != ghost ({ghost_count})",
            plan.subscriber_count
        );
    }
}

/// INV-5: Paused subscriptions must have `paused_at > 0`.
fn invariant_paused_at_nonzero_when_paused(handler: &ContractHandler) {
    for (&sub_id, status) in &handler.ghost.sub_status {
        if *status == SubscriptionStatus::Paused {
            let sub = handler.client.get_subscription(&sub_id);
            // Only check if the contract still reports it as paused
            // (auto-resume may have fired)
            if sub.status == SubscriptionStatus::Paused {
                assert!(
                    sub.paused_at > 0,
                    "INV-5 VIOLATED: sub {sub_id} is Paused but paused_at == 0"
                );
                assert!(
                    sub.pause_duration > 0,
                    "INV-5 VIOLATED: sub {sub_id} is Paused but pause_duration == 0"
                );
            }
        }
    }
}

/// INV-7: `refund_requested_amount <= total_paid` for every tracked subscription.
fn invariant_refund_amount_bounded(handler: &ContractHandler) {
    for &sub_id in handler.ghost.sub_total_paid.keys() {
        let sub = handler.client.get_subscription(&sub_id);
        assert!(
            sub.refund_requested_amount >= 0,
            "INV-7 VIOLATED: sub {sub_id} refund_requested_amount is negative ({})",
            sub.refund_requested_amount
        );
        assert!(
            sub.refund_requested_amount <= sub.total_paid,
            "INV-7 VIOLATED: sub {sub_id} refund_requested_amount ({}) > total_paid ({})",
            sub.refund_requested_amount,
            sub.total_paid
        );
    }
}

/// INV-9: Ghost total_collected is always >= 0.
fn invariant_total_collected_nonnegative(handler: &ContractHandler) {
    assert!(
        handler.ghost.total_collected >= 0,
        "INV-9 VIOLATED: total_collected is negative ({})",
        handler.ghost.total_collected
    );
}

/// INV-10: Every sub_id in a user's subscription list resolves to a real
/// subscription whose `subscriber` field matches the queried address.
fn invariant_user_subs_index_consistency(handler: &ContractHandler) {
    for subscriber in &handler.subscribers {
        let ids = handler.client.get_user_subscriptions(subscriber);
        for i in 0..ids.len() {
            let sub_id = ids.get_unchecked(i);
            let sub = handler.client.get_subscription(&sub_id);
            assert_eq!(
                sub.subscriber, *subscriber,
                "INV-10 VIOLATED: sub {sub_id} in user index for {subscriber:?} \
                 but subscriber field is {:?}",
                sub.subscriber
            );
        }
    }
}
