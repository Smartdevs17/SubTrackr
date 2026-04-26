#[cfg(test)]
mod fuzz_tests {
    use soroban_sdk::{testutils::*, Address, Env, String};
    use subtrackr_subscription::SubTrackrSubscription;
    use subtrackr_types::Interval;

    // ════════════════════════════════════════════════════════════════
    // TEST 1: Negative Prices (Step 4)
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_negative_prices() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let merchant = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            merchant.clone(),
        );
        
        // Try NEGATIVE price (should fail!)
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.create_plan(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                merchant.clone(),
                String::from_str(&env, "bad_plan"),
                -1000,  // ⚠️ NEGATIVE price
                Address::random(&env),
                Interval::Month,
            );
        }));
        
        assert!(result.is_err(), "Should reject negative price!");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 2: Huge Numbers (Step 5)
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_huge_prices() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let merchant = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            merchant.clone(),
        );
        
        // Try HUGE number (might cause overflow!)
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.create_plan(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                merchant.clone(),
                String::from_str(&env, "expensive_plan"),
                i128::MAX,  // ⚠️ BIGGEST NUMBER
                Address::random(&env),
                Interval::Month,
            );
        }));
        
        // Should either work OR fail gracefully, not crash!
        println!("Result: {:?}", result);
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 3: Pause Duration Limits (Step 6)
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_pause_duration_limits() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let admin = Address::random(&env);
        let merchant = Address::random(&env);
        let subscriber = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            admin.clone(),
        );
        
        // Create a plan and subscribe
        let plan_id = contract.create_plan(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            merchant,
            String::from_str(&env, "plan"),
            100,
            Address::random(&env),
            Interval::Month,
        );
        
        let sub_id = contract.subscribe(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            subscriber.clone(),
            plan_id,
        );
        
        // Try to pause for TOO LONG (30 days + 1 second = should fail!)
        let too_long = 2_592_001;  // 30 days + 1 second
        
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.pause_by_subscriber(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                subscriber.clone(),
                sub_id,
                too_long,  // ⚠️ TOO LONG
            );
        }));
        
        assert!(result.is_err(), "Should reject pause duration > 30 days!");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 4: Invalid State Transitions - Cancel Twice (Step 7)
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_invalid_state_transitions() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let admin = Address::random(&env);
        let merchant = Address::random(&env);
        let subscriber = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            admin.clone(),
        );
        
        let plan_id = contract.create_plan(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            merchant,
            String::from_str(&env, "plan"),
            100,
            Address::random(&env),
            Interval::Month,
        );
        
        let sub_id = contract.subscribe(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            subscriber.clone(),
            plan_id,
        );
        
        // Cancel subscription (first time - should work)
        contract.cancel_subscription(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            subscriber.clone(),
            sub_id,
        );
        
        // Try to cancel AGAIN (should fail!)
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.cancel_subscription(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                subscriber.clone(),
                sub_id,
            );
        }));
        
        assert!(result.is_err(), "Cannot cancel already cancelled subscription!");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 5: Refund Limits (Step 8)
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_refund_limits() {
        let env = Env::default();
        
        // Test scenario: Customer paid $100, tries to refund $200
        let total_paid = 100i128;
        let refund_requested = 200i128;
        
        // This should fail because ref
