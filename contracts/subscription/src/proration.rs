use soroban_sdk::{Address, Env, String};
use subtrackr_types::{Interval, Subscription};

/// Proration calculation result
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProrationResult {
    /// Amount to charge (positive) or credit (negative)
    pub amount: i128,
    /// Number of days remaining in current billing period
    pub remaining_days: u64,
    /// Total days in the billing period
    pub period_days: u64,
    /// The prorated daily rate of the old plan
    pub old_daily_rate: i128,
    /// The prorated daily rate of the new plan
    pub new_daily_rate: i128,
    /// Whether this is a charge or credit
    pub is_credit: bool,
    /// Human-readable description
    pub description: String,
}

/// Effective date for plan changes
#[derive(Clone, Debug, PartialEq)]
pub enum EffectiveDate {
    /// Change takes effect immediately
    Immediate,
    /// Change takes effect at the end of the current billing period
    EndOfPeriod,
}

/// Calculate the number of days in a billing interval
fn interval_days(interval: &Interval) -> u64 {
    match interval {
        Interval::Daily => 1,
        Interval::Weekly => 7,
        Interval::Monthly => 30,
        Interval::Quarterly => 90,
        Interval::Yearly => 365,
    }
}

/// Calculate proration for a plan change
/// 
/// Formula: (new_rate - old_rate) * remaining_days / period_days
/// 
/// # Arguments
/// * `env` — Soroban environment for timestamp access
/// * `subscription` — Current subscription state
/// * `old_price` — Current plan price
/// * `new_price` — New plan price
/// * `effective_date` — When the change takes effect
/// 
/// # Returns
/// ProrationResult with calculated amounts
pub fn calculate_proration(
    env: &Env,
    subscription: &Subscription,
    old_price: i128,
    new_price: i128,
    effective_date: EffectiveDate,
) -> ProrationResult {
    let now = env.ledger().timestamp();
    let period_seconds = subscription.next_charge_at - subscription.last_charged_at;
    let period_days = period_seconds / 86400;
    
    let remaining_seconds = if effective_date == EffectiveDate::EndOfPeriod {
        0 // No proration if effective at end of period
    } else {
        subscription.next_charge_at.saturating_sub(now)
    };
    let remaining_days = remaining_seconds / 86400;
    
    let old_daily_rate = old_price / period_days as i128;
    let new_daily_rate = new_price / period_days as i128;
    
    let amount = if effective_date == EffectiveDate::EndOfPeriod {
        0
    } else {
        (new_price - old_price) * remaining_days as i128 / period_days as i128
    };
    
    let is_credit = amount < 0;
    let abs_amount = amount.abs();
    
    let description = if is_credit {
        String::from_str(env, "Prorated credit for plan downgrade")
    } else if amount > 0 {
        String::from_str(env, "Prorated charge for plan upgrade")
    } else {
        String::from_str(env, "No proration required")
    };
    
    ProrationResult {
        amount: abs_amount,
        remaining_days,
        period_days,
        old_daily_rate,
        new_daily_rate,
        is_credit,
        description,
    }
}

/// Preview proration without applying changes
/// 
/// Returns the ProrationResult for display to the user before confirmation
pub fn preview_proration(
    env: &Env,
    subscription: &Subscription,
    old_price: i128,
    new_price: i128,
    effective_date: EffectiveDate,
) -> ProrationResult {
    calculate_proration(env, subscription, old_price, new_price, effective_date)
}

/// Generate a credit memo for downgrade credits
/// 
/// Credit memos are stored on-chain and can be applied to future invoices
pub fn generate_credit_memo(
    env: &Env,
    subscription_id: u64,
    amount: i128,
    reason: String,
) -> CreditMemo {
    CreditMemo {
        subscription_id,
        amount,
        reason,
        created_at: env.ledger().timestamp(),
        applied: false,
    }
}

/// Credit memo structure for on-chain storage
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditMemo {
    pub subscription_id: u64,
    pub amount: i128,
    pub reason: String,
    pub created_at: u64,
    pub applied: bool,
}

/// Apply a credit memo to reduce a charge amount
/// 
/// Returns the remaining charge after credit application
pub fn apply_credit_memo(
    charge_amount: i128,
    credit_memo: &mut CreditMemo,
) -> i128 {
    if credit_memo.applied || credit_memo.amount <= 0 {
        return charge_amount;
    }
    
    let credit_to_apply = charge_amount.min(credit_memo.amount);
    credit_memo.amount -= credit_to_apply;
    credit_memo.applied = credit_memo.amount == 0;
    
    charge_amount - credit_to_apply
}

/// Handle edge case: multiple changes within one cycle
/// 
/// When a user changes plans multiple times in one billing period,
/// we track the net proration across all changes
pub fn calculate_net_proration(
    env: &Env,
    subscription: &Subscription,
    price_changes: &[(i128, i128, EffectiveDate)], // (old_price, new_price, effective_date)
) -> ProrationResult {
    let mut total_amount: i128 = 0;
    
    for (old_price, new_price, effective_date) in price_changes {
        let result = calculate_proration(env, subscription, *old_price, *new_price, effective_date.clone());
        if result.is_credit {
            total_amount -= result.amount;
        } else {
            total_amount += result.amount;
        }
    }
    
    let is_credit = total_amount < 0;
    let abs_amount = total_amount.abs();
    
    let description = if is_credit {
        String::from_str(env, "Net prorated credit for multiple plan changes")
    } else if total_amount > 0 {
        String::from_str(env, "Net prorated charge for multiple plan changes")
    } else {
        String::from_str(env, "No net proration for plan changes")
    };
    
    ProrationResult {
        amount: abs_amount,
        remaining_days: 0, // Aggregate doesn't have a single remaining period
        period_days: interval_days(&Interval::Monthly), // Default
        old_daily_rate: 0,
        new_daily_rate: 0,
        is_credit,
        description,
    }
}

/// Handle zero-dollar prorations
/// 
/// Returns true if the proration rounds to zero
pub fn is_zero_proration(result: &ProrationResult) -> bool {
    result.amount == 0
}

/// Rounding accuracy helper
/// 
/// Ensures consistent rounding across the system
pub fn round_proration_amount(amount: i128, decimals: u32) -> i128 {
    let factor = 10i128.pow(decimals);
    (amount + factor / 2) / factor * factor
}