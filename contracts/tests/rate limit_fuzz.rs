#[cfg(test)]
mod rate_limit_fuzz_tests {
    use soroban_sdk::{testutils::*, Address, Env, String};
    use subtrackr_subscription::SubTrackrSubscription;
    use subtrackr_types::Interval;

    // ════════════════════════════════════════════════════════════════
    // TEST: Rate Limit with Different Intervals
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_rate_limit_intervals() {
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
        
        // Test various rate limit intervals
        let intervals = vec![
            0u64,           // No limit
            1,              // 1 second
            60,             // 1 minute
            3600,           // 1 hour
            86400,          // 1 day
            604800,         // 1 week
        ];
        
        for interval in intervals {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.set_rate_limit(
                    env.clone(),
                    proxy.clone(),
                    storage.clone(),
                    String::from_str(&env, "test_function"),
                    interval,
                );
            }));
            
            assert!(result.is_ok(), "Should accept rate limit interval: {}", interval);
            println!("Rate limit {} seconds set successfully", interval);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // TEST: Rate Limit Removal
    // ═══════════════════���════════════════════════════════════════════
    
    #[test]
    fn test_rate_limit_removal() {
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
        
        let function_name = String::from_str(&env, "test_function");
        
        // Set rate limit
        contract.set_rate_limit(
            env.clone(),
            proxy.clone(),
            storage.clone(),
            function_name.clone(),
            60,  // 60 second limit
        );
        
        // Remove rate limit
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.remove_rate_limit(
                env.clone(),
                proxy.clone(),
                storage.clone(),
                function_name.clone(),
            );
        }));
        
        assert!(result.is_ok(), "Should successfully remove rate limit");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST: Multiple Rate Limits
    // ════════════════════════════════════════════════════════════════
    
    #[test]
    fn test_multiple_rate_limits() {
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
        
        // Set rate limits for different functions
        let functions = vec![
            "create_plan",
            "subscribe",
            "cancel_subscription",
            "charge_subscription",
        ];
        
        for func_name in functions {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.set_rate_limit(
                    env.clone(),
                    proxy.clone(),
                    storage.clone(),
                    String::from_str(&env, func_name),
                    60,  // 60 second limit
                );
            }));
            
            assert!(result.is_ok(), "Should set rate limit for {}", func_name);
            println!("Rate limit set for: {}", func_name);
        }
    }
}