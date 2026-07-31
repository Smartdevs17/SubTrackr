extern crate alloc;
use alloc::format;
use alloc::string::ToString;

use soroban_sdk::{token, Address, Env, String, Symbol, Vec};
use subtrackr_types::{PaymentMethod, PaymentMethodId, PaymentPriority, TokenType};

const MAX_PAYMENT_METHODS: u32 = 10;
const DEFAULT_EXPIRY_WARNING_DAYS: u64 = 30 * 24 * 60 * 60;

fn priority_weight(priority: &PaymentPriority) -> u32 {
    match priority {
        PaymentPriority::Primary => 0,
        PaymentPriority::Backup => 1,
        PaymentPriority::Fallback => 2,
    }
}

fn user_method_list_key(env: &Env, user: &Address) -> Symbol {
    let formatted = format!("pm_list_{:?}", user);
    Symbol::new(env, &formatted)
}

fn method_key(env: &Env, user: &Address, method_id: PaymentMethodId) -> Symbol {
    let formatted = format!("pm_{:?}_{}", user, method_id);
    Symbol::new(env, &formatted)
}

fn user_count_key(env: &Env, user: &Address) -> Symbol {
    let formatted = format!("pm_count_{:?}", user);
    Symbol::new(env, &formatted)
}

fn get_user_count(env: &Env, user: &Address) -> u64 {
    env.storage()
        .persistent()
        .get::<_, u64>(&user_count_key(env, user))
        .unwrap_or(0)
}

fn set_user_count(env: &Env, user: &Address, count: u64) {
    env.storage()
        .persistent()
        .set(&user_count_key(env, user), &count);
}

fn get_user_method_ids(env: &Env, user: &Address) -> Vec<PaymentMethodId> {
    env.storage()
        .persistent()
        .get::<_, Vec<PaymentMethodId>>(&user_method_list_key(env, user))
        .unwrap_or(Vec::new(env))
}

fn set_user_method_ids(env: &Env, user: &Address, ids: Vec<PaymentMethodId>) {
    env.storage()
        .persistent()
        .set(&user_method_list_key(env, user), &ids);
}

fn get_method(env: &Env, user: &Address, method_id: PaymentMethodId) -> Option<PaymentMethod> {
    env.storage()
        .persistent()
        .get(&method_key(env, user, method_id))
}

fn set_method(env: &Env, user: &Address, method_id: PaymentMethodId, method: &PaymentMethod) {
    env.storage()
        .persistent()
        .set(&method_key(env, user, method_id), method);
}

fn remove_method(env: &Env, user: &Address, method_id: PaymentMethodId) {
    env.storage()
        .persistent()
        .remove(&method_key(env, user, method_id));
}

fn sort_by_priority(env: &Env, storage: &Address, user: &Address) -> Vec<PaymentMethod> {
    let method_ids = get_user_method_ids(env, user);
    let mut methods: Vec<PaymentMethod> = Vec::new(env);

    for id in method_ids.iter() {
        if let Some(method) = get_method(env, user, id) {
            if method.is_active && method.is_verified {
                methods.push_back(method);
            }
        }
    }
    let _ = storage;

    let mut i = 0u32;
    let len = methods.len();
    while i < len {
        let mut j = i + 1;
        while j < len {
            let a = methods.get(i).unwrap();
            let b = methods.get(j).unwrap();
            let a_prio = priority_weight(&a.priority);
            let b_prio = priority_weight(&b.priority);
            if a_prio > b_prio || (a_prio == b_prio && a.last_used_at < b.last_used_at) {
                let temp = a;
                methods.set(i, b);
                methods.set(j, temp);
            }
            j += 1;
        }
        i += 1;
    }

    methods
}

fn check_expired(method: &PaymentMethod, env: &Env) -> bool {
    if method.expires_at == 0 {
        return false;
    }
    env.ledger().timestamp() >= method.expires_at
}

fn check_expiring_soon(method: &PaymentMethod, env: &Env) -> bool {
    if method.expires_at == 0 {
        return false;
    }
    let now = env.ledger().timestamp();
    if now >= method.expires_at {
        return false;
    }
    method.expires_at - now <= DEFAULT_EXPIRY_WARNING_DAYS
}

pub(crate) fn add_payment_method(
    env: &Env,
    user: &Address,
    token_type: TokenType,
    token_address: Address,
    chain_id: u64,
    label: String,
    priority: PaymentPriority,
    max_spend_per_interval: i128,
) -> PaymentMethodId {
    let count = get_user_count(env, user);
    assert!(
        count < MAX_PAYMENT_METHODS as u64,
        "Maximum payment methods reached (10)"
    );
    assert!(
        max_spend_per_interval > 0,
        "Max spend per interval must be positive"
    );

    let now = env.ledger().timestamp();
    let new_id = count + 1;

    let method = PaymentMethod {
        id: new_id,
        user: user.clone(),
        token_type,
        token_address,
        chain_id,
        label,
        priority,
        max_spend_per_interval,
        is_verified: false,
        is_active: true,
        expires_at: 0,
        last_used_at: 0,
        created_at: now,
        updated_at: now,
        metadata: Vec::new(env),
    };

    set_method(env, user, new_id, &method);

    let mut user_methods = get_user_method_ids(env, user);
    user_methods.push_back(new_id);
    set_user_method_ids(env, user, user_methods);
    set_user_count(env, user, new_id);

    env.events().publish(
        (String::from_str(env, "payment_method_added"), user.clone()),
        (
            new_id,
            method.token_type,
            priority_weight(&method.priority),
            now,
        ),
    );

    new_id
}

pub(crate) fn remove_payment_method(env: &Env, user: &Address, method_id: PaymentMethodId) {
    let method = get_method(env, user, method_id).expect("Payment method not found");
    assert!(method.user == *user, "Only owner can remove payment method");

    remove_method(env, user, method_id);

    let user_methods = get_user_method_ids(env, user);
    let mut updated: Vec<PaymentMethodId> = Vec::new(env);
    for id in user_methods.iter() {
        if id != method_id {
            updated.push_back(id);
        }
    }
    set_user_method_ids(env, user, updated);

    env.events().publish(
        (
            String::from_str(env, "payment_method_removed"),
            user.clone(),
        ),
        method_id,
    );
}

pub(crate) fn verify_payment_method(env: &Env, user: &Address, method_id: PaymentMethodId) {
    let mut method = get_method(env, user, method_id).expect("Payment method not found");
    assert!(method.user == *user, "Only owner can verify");

    let now = env.ledger().timestamp();
    method.is_verified = true;
    method.updated_at = now;

    set_method(env, user, method_id, &method);

    env.events().publish(
        (
            String::from_str(env, "payment_method_verified"),
            user.clone(),
        ),
        (method_id, method.token_type, now),
    );
}

pub(crate) fn set_payment_method_priority(
    env: &Env,
    user: &Address,
    method_id: PaymentMethodId,
    priority: PaymentPriority,
) {
    let mut method = get_method(env, user, method_id).expect("Payment method not found");
    assert!(method.user == *user, "Only owner can change priority");

    let now = env.ledger().timestamp();
    method.priority = priority.clone();
    method.updated_at = now;

    set_method(env, user, method_id, &method);

    env.events().publish(
        (
            String::from_str(env, "payment_method_priority_updated"),
            user.clone(),
        ),
        (method_id, priority_weight(&priority), now),
    );
}

pub(crate) fn set_payment_method_expiry(
    env: &Env,
    user: &Address,
    method_id: PaymentMethodId,
    expires_at: u64,
) {
    let mut method = get_method(env, user, method_id).expect("Payment method not found");
    assert!(method.user == *user, "Only owner can set expiry");

    let now = env.ledger().timestamp();
    method.expires_at = expires_at;
    method.updated_at = now;

    set_method(env, user, method_id, &method);

    env.events().publish(
        (
            String::from_str(env, "payment_method_expiry_set"),
            user.clone(),
        ),
        (method_id, expires_at, now),
    );
}

pub(crate) fn charge_with_fallback(
    env: &Env,
    user: &Address,
    merchant: &Address,
    token_address: &Address,
    amount: i128,
    subscription_id: u64,
) -> bool {
    let sorted = sort_by_priority(env, &user.clone(), user);

    if sorted.len() == 0 {
        env.events().publish(
            (
                String::from_str(env, "payment_fallback_exhausted"),
                user.clone(),
            ),
            (subscription_id, amount),
        );
        return false;
    }

    let mut i = 0u32;
    let len = sorted.len();
    while i < len {
        let method = sorted.get(i).unwrap();
        let now = env.ledger().timestamp();

        if check_expired(&method, env) {
            env.events().publish(
                (
                    String::from_str(env, "payment_method_expired_skipped"),
                    user.clone(),
                ),
                (method.id, subscription_id),
            );
            i += 1;
            continue;
        }

        if amount > method.max_spend_per_interval {
            env.events().publish(
                (
                    String::from_str(env, "payment_method_limit_exceeded"),
                    user.clone(),
                ),
                (method.id, amount, method.max_spend_per_interval),
            );
            i += 1;
            continue;
        }

        let balance = token::Client::new(env, &method.token_address).balance(user);
        if balance < amount {
            env.events().publish(
                (
                    String::from_str(env, "payment_method_insufficient_balance"),
                    user.clone(),
                ),
                (method.id, subscription_id, balance, amount),
            );
            i += 1;
            continue;
        }

        token::Client::new(env, &method.token_address).transfer(user, merchant, &amount);

        let mut updated = get_method(env, user, method.id).unwrap_or(method.clone());
        updated.last_used_at = now;
        updated.updated_at = now;
        set_method(env, user, method.id, &updated);

        env.events().publish(
            (
                String::from_str(env, "payment_charge_success"),
                user.clone(),
            ),
            (
                subscription_id,
                amount,
                method.id,
                method.token_type.clone(),
                now,
            ),
        );

        return true;
    }

    env.events().publish(
        (
            String::from_str(env, "payment_fallback_exhausted"),
            user.clone(),
        ),
        (subscription_id, amount),
    );

    false
}

pub(crate) fn get_payment_method(
    env: &Env,
    user: &Address,
    method_id: PaymentMethodId,
) -> PaymentMethod {
    get_method(env, user, method_id).expect("Payment method not found")
}

pub(crate) fn list_payment_methods(env: &Env, user: &Address) -> Vec<PaymentMethod> {
    sort_by_priority(env, &user.clone(), user)
}

pub(crate) fn get_expired_methods(env: &Env, user: &Address) -> Vec<PaymentMethodId> {
    let method_ids = get_user_method_ids(env, user);
    let mut expired: Vec<PaymentMethodId> = Vec::new(env);

    for id in method_ids.iter() {
        if let Some(method) = get_method(env, user, id) {
            if check_expired(&method, env) {
                expired.push_back(id);
            }
        }
    }

    expired
}

pub(crate) fn get_expiring_soon_methods(env: &Env, user: &Address) -> Vec<PaymentMethodId> {
    let method_ids = get_user_method_ids(env, user);
    let mut expiring: Vec<PaymentMethodId> = Vec::new(env);

    for id in method_ids.iter() {
        if let Some(method) = get_method(env, user, id) {
            if check_expiring_soon(&method, env) {
                expiring.push_back(id);
            }
        }
    }

    expiring
}

pub(crate) fn deactivate_expired_methods(env: &Env, user: &Address) -> u32 {
    let expired_ids = get_expired_methods(env, user);
    let count = expired_ids.len() as u32;
    let now = env.ledger().timestamp();

    for id in expired_ids.iter() {
        if let Some(mut method) = get_method(env, user, id) {
            method.is_active = false;
            method.updated_at = now;

            let mut meta = match method.metadata.is_empty() {
                true => Vec::new(env),
                false => method.metadata.clone(),
            };
            meta.push_back((
                String::from_str(env, "deactivated_reason"),
                String::from_str(env, "expired"),
            ));
            meta.push_back((
                String::from_str(env, "deactivated_at"),
                String::from_str(env, &now.to_string()),
            ));
            method.metadata = meta;

            set_method(env, user, id, &method);
        }
    }

    env.events().publish(
        (
            String::from_str(env, "payment_methods_deactivated"),
            user.clone(),
        ),
        (count, now),
    );

    count
}
