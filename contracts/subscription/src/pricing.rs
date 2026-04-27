use soroban_sdk::Vec;
use subtrackr_types::PricingTier;

/// Compute final price using best eligible tier.
///
/// Rules:
/// - Apply highest discount tier where quantity >= min_quantity
/// - Use integer math (basis points) to avoid floating point
/// - Guard against overflow
/// - Deterministic: same inputs always produce same output
///
/// # Arguments
/// * `base_price` - The base price before any discounts
/// * `tiers` - Vector of pricing tiers to evaluate
/// * `quantity` - The quantity to determine tier eligibility
///
/// # Returns
/// The final price after applying the best eligible discount
///
/// # Panics
/// - Panics if overflow occurs during calculation
/// - Panics if computed price is negative
pub fn compute_price(base_price: i128, tiers: &Vec<PricingTier>, quantity: u32) -> i128 {
    // Find best eligible tier (highest discount)
    let mut best_discount_bps: u32 = 0;

    for tier in tiers.iter() {
        if quantity >= tier.min_quantity && tier.discount_bps > best_discount_bps {
            best_discount_bps = tier.discount_bps;
        }
    }

    // Calculate discount: (base_price * discount_bps) / 10000
    let discount = base_price
        .checked_mul(best_discount_bps as i128)
        .expect("Overflow in discount calculation")
        / 10000;

    // Final price = base_price - discount
    let final_price = base_price
        .checked_sub(discount)
        .expect("Overflow in price calculation");

    // Ensure non-negative pricing
    if final_price < 0 {
        panic!("Computed price is negative");
    }

    final_price
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_tier(min_quantity: u32, discount_bps: u32) -> PricingTier {
        PricingTier {
            min_quantity,
            discount_bps,
        }
    }

    #[test]
    fn test_compute_price_no_tiers() {
        // In Soroban tests, we need an Env to create Vec
        // This test will be implemented in integration tests
    }

    #[test]
    fn test_compute_price_single_tier() {
        // Will be tested in integration test context
    }

    #[test]
    fn test_compute_price_multiple_tiers() {
        // Will be tested in integration test context
    }
}
