//! Billing arithmetic shared by the subscription and metering contracts.
//! All functions are allocation-free and return `None` on overflow or invalid
//! inputs so callers can map failures to a contract error without panicking.

/// Amount owed for the elapsed part of a billing period, rounding down.
pub fn prorated_amount(amount: i128, elapsed: u64, total: u64) -> Option<i128> {
    if total == 0 || elapsed > total || amount < 0 {
        return None;
    }
    amount
        .checked_mul(i128::from(elapsed))?
        .checked_div(i128::from(total))
}

/// Start of the period that follows `periods` full intervals after `start`.
pub fn period_end(start: u64, interval: u64, periods: u64) -> Option<u64> {
    if interval == 0 {
        return None;
    }
    start.checked_add(interval.checked_mul(periods)?)
}

/// Number of whole intervals between two timestamps.
pub fn elapsed_periods(start: u64, now: u64, interval: u64) -> Option<u64> {
    if interval == 0 || now < start {
        return None;
    }
    Some((now - start) / interval)
}

/// Sum a tiered fee where each tier is `(upper_bound_inclusive, fee)` and
/// boundaries are strictly increasing.
pub fn tiered_fee(amount: i128, tiers: &[(u64, u32)]) -> i128 {
    let mut previous = 0u64;
    let mut fee = 0i128;
    for &(upper_bound, tier_fee) in tiers {
        if upper_bound <= previous {
            break;
        }
        let upper = i128::from(upper_bound);
        let lower = i128::from(previous);
        let covered = if amount >= upper {
            upper - lower
        } else {
            amount - lower
        };
        if covered <= 0 {
            break;
        }
        fee += covered * i128::from(tier_fee);
        previous = upper_bound;
        if amount < upper {
            break;
        }
    }
    fee
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prorates_partial_periods() {
        assert_eq!(prorated_amount(1_000, 15, 30), Some(500));
        assert_eq!(prorated_amount(1_000, 30, 30), Some(1_000));
        assert_eq!(prorated_amount(1_000, 0, 30), Some(0));
    }

    #[test]
    fn rejects_invalid_proration_inputs() {
        assert_eq!(prorated_amount(1_000, 1, 0), None);
        assert_eq!(prorated_amount(1_000, 31, 30), None);
        assert_eq!(prorated_amount(-1, 1, 30), None);
    }

    #[test]
    fn advances_billing_periods() {
        assert_eq!(period_end(100, 30, 2), Some(160));
        assert_eq!(elapsed_periods(100, 161, 30), Some(2));
        assert_eq!(period_end(100, 0, 2), None);
        assert_eq!(elapsed_periods(100, 99, 30), None);
    }

    #[test]
    fn accumulates_tiered_fees() {
        let tiers = [(10, 100), (100, 50)];
        assert_eq!(tiered_fee(5, &tiers), 500);
        assert_eq!(tiered_fee(50, &tiers), 1_000 + 40 * 50);
        assert_eq!(tiered_fee(100, &tiers), 1_000 + 90 * 50);
    }

    #[test]
    fn stops_at_invalid_tier_boundaries() {
        let tiers = [(10, 100), (10, 50), (20, 25)];
        assert_eq!(tiered_fee(30, &tiers), 1_000);
    }
}
