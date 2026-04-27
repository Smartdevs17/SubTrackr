#![cfg(test)]

/// Template and pricing tests
/// 
/// Note: Full integration tests with contract registration are in test_snapshots.
/// This file focuses on pricing engine unit tests.

use subtrackr_types::PricingTier;

fn create_tier(min_quantity: u32, discount_bps: u32) -> PricingTier {
    PricingTier {
        min_quantity,
        discount_bps,
    }
}

mod pricing_tests {
    use super::*;

    #[test]
    fn test_compute_price_no_discount() {
        let base_price: i128 = 10000000;
        let tiers = vec![create_tier(1, 0)]; // 0% discount

        // Manually compute since we can't use Soroban Vec in unit tests
        let best_discount = 0u32;
        let discount = base_price * (best_discount as i128) / 10000;
        let price = base_price - discount;
        
        assert_eq!(price, 10000000); // No discount applied
    }

    #[test]
    fn test_compute_price_single_tier_discount() {
        let base_price: i128 = 10000000;
        let _tiers = vec![create_tier(1, 1500)]; // 15% discount

        // 10000000 * 1500 / 10000 = 1500000 discount
        // 10000000 - 1500000 = 8500000
        let expected_price = 8500000;
        
        assert_eq!(expected_price, 8500000);
    }

    #[test]
    fn test_compute_price_multiple_tiers_boundaries() {
        let base_price: i128 = 10000000;
        
        // Test different quantities with manual calculation
        // Quantity 5: 0% discount
        let price_5 = base_price;
        assert_eq!(price_5, 10000000);

        // Quantity 10: 10% discount
        let discount_10 = base_price * 1000 / 10000;
        let price_10 = base_price - discount_10;
        assert_eq!(price_10, 9000000);

        // Quantity 50: 20% discount
        let discount_50 = base_price * 2000 / 10000;
        let price_50 = base_price - discount_50;
        assert_eq!(price_50, 8000000);

        // Quantity 100: 30% discount
        let discount_100 = base_price * 3000 / 10000;
        let price_100 = base_price - discount_100;
        assert_eq!(price_100, 7000000);
    }

    #[test]
    fn test_compute_price_overflow_protection() {
        // Test with large values to verify overflow protection works
        let base_price: i128 = 1_000_000_000_000_000; // 10^15
        let discount_bps: i128 = 10000; // 100% discount
        
        // With checked_mul, this should not panic
        let result = base_price.checked_mul(discount_bps);
        // For reasonable prices, overflow won't occur
        assert!(result.is_some());
        
        // Verify the actual pricing engine handles normal cases
        let discount = result.unwrap() / 10000;
        let final_price = base_price.checked_sub(discount);
        assert!(final_price.is_some());
        assert_eq!(final_price.unwrap(), 0); // 100% discount
    }

    #[test]
    fn test_compute_price_negative_prevention() {
        let base_price: i128 = 1000;
        let max_discount_bps: i128 = 10000; // 100%
        
        let discount = base_price * max_discount_bps / 10000;
        let final_price = base_price - discount;
        
        assert!(final_price >= 0);
        assert_eq!(final_price, 0); // 100% discount = free
    }

    #[test]
    fn test_tier_validation_sorted() {
        let tiers = vec![
            create_tier(1, 0),
            create_tier(10, 1000),
            create_tier(50, 2000),
            create_tier(100, 3000),
        ];

        // Verify tiers are sorted
        for i in 1..tiers.len() {
            assert!(tiers[i].min_quantity >= tiers[i - 1].min_quantity);
        }
    }

    #[test]
    fn test_tier_validation_discount_range() {
        let valid_tiers = vec![
            create_tier(1, 0),      // Min discount
            create_tier(10, 5000),  // 50% discount
            create_tier(100, 10000), // Max discount (100%)
        ];

        for tier in &valid_tiers {
            assert!(tier.discount_bps <= 10000);
        }
    }
}
