#[cfg(test)]
mod pricing_fuzz_tests {
    use soroban_sdk::{testutils::*, Address, Env, String};
    use subtrackr_subscription::SubTrackrSubscription;
    use subtrackr_types::Interval;

    // ════════════════════════════════════════════════════════════════
    // TEST: Pricing Calculations with Different Combinations
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_pricing_calculations() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let admin = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            admin.clone(),
        );
        
        // Test different price points
        let prices = vec![
            1i128,              // Cheapest
            100,                // Standard
            1_000,              // Premium
            1_000_000,          // Ultra
            i128::MAX / 2,      // Large value (avoid overflow)
        ];
        
        // Test different intervals
        let intervals = vec![
            Interval::Day,
            Interval::Week,
            Interval::Month,
            Interval::Year,
        ];
        
        let mut total_plans_created = 0;
        
        for price in &prices {
            for interval in &intervals {
                let merchant = Address::random(&env);
                
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    contract.create_plan(
                        env.clone(),
                        proxy.clone(),
                        storage.clone(),
                        merchant.clone(),
                        String::from_str(&env, &format!("plan_{}_{:?}", price, interval)),
                        *price,
                        Address::random(&env),
                        interval.clone(),
                    );
                }));
                
                if result.is_ok() {
                    total_plans_created += 1;
                }
            }
        }
        
        // Verify that plans were created
        let plan_count = contract.get_plan_count(
            env.clone(),
            proxy.clone(),
            storage.clone(),
        );
        
        println!("Total plans created: {}", total_plans_created);
        println!("Plan count from contract: {}", plan_count);
        
        // At least some plans should be created
        assert!(plan_count > 0, "Should create at least one plan");
    }

    // ══════════════════════════════════════════════════════════���═════
    // TEST: Subscription with Different Prices
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_subscriptions_with_different_prices() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let admin = Address::random(&env);
        let merchant = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            admin.clone(),
        );
        
        // Create 3 plans with different prices
        let plan_ids = vec![];
        let prices = vec![10i128, 50, 100];
        
        for price in prices {
            let plan_id = contract.create_plan(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                merchant.clone(),
                String::from_str(&env, &format!("plan_{}", price)),
                price,
                Address::random(&env),
                Interval::Month,
            );
            
            // Subscribe multiple users to same plan
            for user_num in 0..3 {
                let subscriber = Address::random(&env);
                
                let sub_id = contract.subscribe(
                    env.clone(),
                    proxy.clone(),
                    storage.clone(),
                    subscriber.clone(),
                    plan_id,
                );
                
                println!("Subscription {} created with price: {}", sub_id, price);
            }
        }
        
        // Verify subscription count increased
        let sub_count = contract.get_subscription_count(
            env.clone(),
            proxy.clone(),
            storage.clone(),
        );
        
        assert!(sub_count > 0, "Should have subscriptions");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST: Price Boundaries (Min and Max)
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_price_boundaries() {
        let env = Env::default();
        let contract = SubTrackrSubscription;
        
        let proxy = Address::random(&env);
        let storage = Address::random(&env);
        let admin = Address::random(&env);
        let merchant = Address::random(&env);
        
        contract.initialize(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            admin.clone(),
        );
        
        // Test MINIMUM valid price
        let min_price = 1i128;
        let result_min = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.create_plan(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                merchant.clone(),
                String::from_str(&env, "min_price_plan"),
                min_price,
                Address::random(&env),
                Interval::Month,
            );
        }));
        
        assert!(result_min.is_ok(), "Should accept minimum price of $1");
        
        // Test MAXIMUM safe price
        let max_safe_price = i128::MAX / 2;
        let result_max = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.create_plan(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                merchant.clone(),
                String::from_str(&env, "max_price_plan"),
                max_safe_price,
                Address::random(&env),
                Interval::Month,
            );
        }));
        
        println!("Max price result: {:?}", result_max);
    }
}