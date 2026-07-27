/// Payment Processing Module
///
/// Handles subscription charges, refunds, and oracle-based price resolution.
/// Extracted from the monolithic contract for better maintainability.
use soroban_sdk::{token, Address, Env, String, Symbol, Vec};

use crate::enforce_rate_limit;
use crate::get_admin;
use crate::storage_persistent_get;
use crate::storage_persistent_set;
use subtrackr_types::{Invoice, Plan, PriceBounds, StorageKey, Subscription, SubscriptionStatus, TimeRange};

use crate::revenue;
use super::subscription_lifecycle;

/// Resolve the charge price for a plan, using oracle pricing if available.
pub fn resolve_charge_price(env: &Env, storage: &Address, plan: &Plan) -> i128 {
    let oracle_opt: Option<Address> =
        storage_persistent_get(env, storage, StorageKey::OracleContract);
    let bounds_opt: Option<PriceBounds> =
        storage_persistent_get(env, storage, StorageKey::PriceBounds(plan.id));

    if oracle_opt.is_none() || bounds_opt.is_none() {
        return plan.price;
    }

    let oracle = oracle_opt.unwrap();
    let bounds = bounds_opt.unwrap();

    let token_sym_opt: Option<Symbol> =
        storage_persistent_get(env, storage, StorageKey::TokenSymbol(plan.token.clone()));

    if token_sym_opt.is_none() {
        return plan.price;
    }

    let token_sym = token_sym_opt.unwrap();
    let quote_sym = Symbol::new(env, &string_to_symbol_str(env, &bounds.quote));

    let client = subtrackr_oracle::SubTrackrOracleClient::new(env, &oracle);

    if let Ok(price) = client.try_get_price_with_cache(&token_sym, &quote_sym, &600) {
        let oracle_value = price.value;
        if oracle_value <= 0 {
            return plan.price;
        }

        let max_price = (plan.price as u128)
            .saturating_mul(bounds.max_price_bps as u128)
            / 10_000;
        let min_price = (plan.price as u128)
            .saturating_mul(bounds.min_price_bps as u128)
            / 10_000;

        if oracle_value > max_price as i128 {
            max_price as i128
        } else if oracle_value < min_price as i128 {
            min_price as i128
        } else {
            oracle_value
        }
    } else {
        plan.price
    }
}

/// Charge a subscription: transfer tokens and update state.
pub fn charge_subscription(env: &Env, storage: &Address, subscription_id: u64) {
    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    if sub.subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, &sub.subscriber, "charge_subscription");
    }

    sub.subscriber.require_auth();

    // Auto-resume if pause period has elapsed
    if subscription_lifecycle::check_and_resume(env, &mut sub) {
        storage_persistent_set(
            env,
            storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );
    }

    assert!(
        sub.status == SubscriptionStatus::Active,
        "Subscription not active"
    );

    let now = env.ledger().timestamp();
    assert!(now >= sub.next_charge_at, "Payment not yet due");

    let plan: Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(sub.plan_id)).expect("Plan not found");

    let charge_price = resolve_charge_price(env, storage, &plan);

    token::Client::new(env, &plan.token).transfer(&sub.subscriber, &plan.merchant, &charge_price);

    sub.last_charged_at = now;
    sub.next_charge_at = now + plan.interval.seconds();
    sub.total_paid += charge_price;
    sub.total_gas_spent += 100_000;
    sub.charge_count += 1;

    storage_persistent_set(
        env,
        storage,
        StorageKey::Subscription(subscription_id),
        sub.clone(),
    );

    // Generate revenue recognition schedule
    revenue::generate_revenue_schedule(
        env,
        storage,
        subscription_id,
        sub.plan_id,
        charge_price,
        now,
        plan.interval.seconds(),
    );
    revenue::update_merchant_revenue_balances(env, storage, &plan.merchant, 0, charge_price);
    revenue::track_merchant_subscription(env, storage, &plan.merchant, subscription_id);

    env.events().publish(
        (
            String::from_str(env, "subscription_charged"),
            subscription_id,
        ),
        (sub.subscriber.clone(), charge_price, 100_000u64, now),
    );

    // Generate invoice if invoice contract is configured
    if let Some(invoice_addr) = get_invoice_contract(env, storage) {
        let period = TimeRange {
            start: sub.last_charged_at,
            end: sub.next_charge_at,
        };
        let _invoice: Invoice = env.invoke_contract(
            &invoice_addr,
            &Symbol::new(env, "generate_invoice"),
            soroban_sdk::vec![
                env,
                storage.clone().into_val(env),
                subscription_id.into_val(env),
                period.into_val(env),
                String::from_str(env, "GLOBAL").into_val(env),
                String::from_str(env, "").into_val(env),
            ],
        );
        let _ = _invoice;
    }
}

/// Request a refund for a subscription.
pub fn request_refund(
    env: &Env,
    storage: &Address,
    subscription_id: u64,
    amount: i128,
) {
    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    if sub.subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, &sub.subscriber, "request_refund");
    }

    sub.subscriber.require_auth();

    assert!(amount > 0, "Refund amount must be positive");
    assert!(
        amount <= sub.total_paid,
        "Refund amount cannot exceed total paid"
    );

    sub.refund_requested_amount = amount;
    storage_persistent_set(
        env,
        storage,
        StorageKey::Subscription(subscription_id),
        sub.clone(),
    );

    env.events().publish(
        (String::from_str(env, "refund_requested"), subscription_id),
        (sub.subscriber.clone(), amount),
    );
}

/// Approve a pending refund request (admin only).
pub fn approve_refund(env: &Env, storage: &Address, subscription_id: u64) {
    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    let admin = get_admin(env, storage);
    admin.require_auth();

    let amount = sub.refund_requested_amount;
    assert!(amount > 0, "No pending refund request");

    sub.total_paid -= amount;
    sub.refund_requested_amount = 0;

    storage_persistent_set(
        env,
        storage,
        StorageKey::Subscription(subscription_id),
        sub.clone(),
    );

    env.events().publish(
        (String::from_str(env, "refund_approved"), subscription_id),
        (sub.subscriber.clone(), amount),
    );
}

/// Reject a pending refund request (admin only).
pub fn reject_refund(env: &Env, storage: &Address, subscription_id: u64) {
    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    let admin = get_admin(env, storage);
    admin.require_auth();

    assert!(sub.refund_requested_amount > 0, "No pending refund request");
    sub.refund_requested_amount = 0;

    storage_persistent_set(
        env,
        storage,
        StorageKey::Subscription(subscription_id),
        sub.clone(),
    );

    env.events().publish(
        (String::from_str(env, "refund_rejected"), subscription_id),
        sub.subscriber.clone(),
    );
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

fn get_invoice_contract(env: &Env, storage: &Address) -> Option<Address> {
    storage_persistent_get(env, storage, StorageKey::InvoiceContract)
}

fn string_to_symbol_str(env: &Env, s: &subtrackr_types::String) -> soroban_sdk::Vec<u8> {
    let bytes = s.as_bytes();
    let mut result: soroban_sdk::Vec<u8> = soroban_sdk::Vec::new(env);
    for i in 0..bytes.len() {
        result.push_back(bytes.get(i).unwrap());
    }
    result
}
