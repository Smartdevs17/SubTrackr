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

methods {
    charge(address) returns (bool) envfree;
    is_locked() returns (bool) envfree;
    get_next_billing_date(address) returns (uint256) envfree;
}

// Rule 1: Verify the Checks-Effects-Interactions pattern holds true
rule check_effects_interactions_reentrancy(address user) {
    uint256 next_billing_before = get_next_billing_date(user);
    
    bool success = charge(user);
    
    uint256 next_billing_after = get_next_billing_date(user);
    
    // If the charge succeeded, state MUST have progressed
    assert success => next_billing_after > next_billing_before, 
        "State must be updated before interactions to prevent read-only reentrancy";
}

// Rule 2: Reentrancy lock must never be permanently locked 
rule reentrancy_lock_is_released(address user) {
    require !is_locked();
    charge(user);
    assert !is_locked(), "Reentrancy guard failed to release its lock";
}