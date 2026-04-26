// Placeholder Certora-style rule file for CI integration.
// The exact contract bindings should be updated when Certora harness generation is added.

methods {
    // Core state transitions
    subscribe(env, proxy, storage, subscriber, plan_id) returns uint64 envfree;
    cancel_subscription(env, proxy, storage, subscriber, subscription_id) envfree;
    pause_subscription(env, proxy, storage, subscriber, subscription_id) envfree;
    resume_subscription(env, proxy, storage, subscriber, subscription_id) envfree;
    charge_subscription(env, proxy, storage, subscription_id) envfree;
}

rule noCancelledToActive(uint64 subscription_id) {
    // Placeholder rule: implementation should assert cancelled subscriptions
    // cannot return to Active status after cancellation.
    true;
}

rule subscriptionCountMonotonic() {
    // Placeholder invariant: subscription count never decreases.
    true;
}

rule refundBoundedByTotalPaid(uint64 subscription_id) {
    // Placeholder invariant: refund request <= total paid.
    true;
}
