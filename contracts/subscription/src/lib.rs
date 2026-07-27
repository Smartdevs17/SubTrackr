#![no_std]

// ── Module declarations ──────────────────────────────────────────────────────
mod admin;
mod gas_optimization;
mod gas_profiler;
mod gas_storage;
mod payment;
mod plan;
pub mod quota;
mod subscription_lifecycle;
pub mod usage;

pub mod revenue;
pub mod webhook;

use soroban_sdk::{Address, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec};
use subtrackr_oracle::OracleError;
use subtrackr_types::{StorageKey};

const STORAGE_VERSION: u32 = 2;

fn storage_instance_get<V: TryFromVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
) -> Option<V> {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "instance_get"),
        args,
    );
    val_opt.map(|val| V::try_from_val(env, &val).unwrap())
}

fn storage_instance_set<V: IntoVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
    value: V,
) {
    let val: Val = value.into_val(env);
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env), val];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "instance_set"),
        args,
    );
}

fn storage_instance_remove(env: &Env, storage: &Address, key: StorageKey) {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "instance_remove"),
        args,
    );
}

fn storage_persistent_get<V: TryFromVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
) -> Option<V> {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_get"),
        args,
    );
    val_opt.map(|val| V::try_from_val(env, &val).unwrap())
}

fn storage_persistent_set<V: IntoVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
    value: V,
) {
    let val: Val = value.into_val(env);
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env), val];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_set"),
        args,
    );
}

fn storage_persistent_remove(env: &Env, storage: &Address, key: StorageKey) {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "persistent_remove"),
        args,
    );
}

pub(crate) fn get_admin(env: &Env, storage: &Address) -> Address {
    storage_instance_get(env, storage, StorageKey::Admin).expect("Admin not set")
}

pub(crate) fn enforce_rate_limit(env: &Env, storage: &Address, caller: &Address, function_name: &str) {
    let fname = String::from_str(env, function_name);
    let min_interval: Option<u64> =
        storage_instance_get(env, storage, StorageKey::RateLimit(fname.clone()));
    if min_interval.is_none() {
        return;
    }
    let min_secs = min_interval.unwrap();
    if min_secs == 0 {
        return;
    }

    let now = env.ledger().timestamp();
    let last_opt: Option<u64> = storage_instance_get(
        env,
        storage,
        StorageKey::LastCall(caller.clone(), fname.clone()),
    );

    if let Some(last) = last_opt {
        if now < last + min_secs {
            env.events().publish(
                (
                    String::from_str(env, "rate_limit_violation"),
                    caller.clone(),
                ),
                (fname.clone(), last, now, min_secs),
            );
            panic!("Rate limited: please wait before calling this function again");
        }
    }

    storage_instance_set(
        env,
        storage,
        StorageKey::LastCall(caller.clone(), fname),
        now,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation Contract (Modular Architecture)
//
// This contract now delegates to focused modules:
//   - plan.rs           Plan creation, deactivation, queries
//   - subscription_lifecycle.rs  Subscribe, cancel, pause, resume
//   - payment.rs        Charge, refund, oracle price resolution
//   - admin.rs          Initialization, oracle, rate limiting, quotas
//   - revenue.rs        Revenue recognition (unchanged)
//   - usage.rs          Usage tracking (unchanged)
//   - quota.rs          Quota management (unchanged)
//   - webhook.rs        Webhook management (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

#[soroban_sdk::contract]
pub struct SubTrackrSubscription;

#[soroban_sdk::contractimpl]
impl SubTrackrSubscription {
    // ── Upgrade interface ──

    pub fn get_version(_env: Env, proxy: Address, _storage: Address) -> u32 {
        proxy.require_auth();
        STORAGE_VERSION
    }

    pub fn validate_upgrade(env: Env, proxy: Address, storage: Address, from_version: u32) {
        proxy.require_auth();
        assert!(from_version > 0, "Invalid version");
        assert!(
            from_version <= STORAGE_VERSION,
            "Cannot upgrade from future version"
        );

        let _admin: Address = get_admin(&env, &storage);
        let _plan_count: u64 =
            storage_instance_get(&env, &storage, StorageKey::PlanCount).unwrap_or(0);
        let _sub_count: u64 =
            storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0);
    }

    pub fn migrate(env: Env, proxy: Address, storage: Address, from_version: u32) {
        proxy.require_auth();
        if from_version == STORAGE_VERSION {
            return;
        }
        assert!(from_version < STORAGE_VERSION, "Unsupported migration path");

        if from_version == 1 {
            let sub_count: u64 =
                storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0);
            let mut i: u64 = 1;
            while i <= sub_count {
                let sub_opt: Option<subtrackr_types::Subscription> =
                    storage_persistent_get(&env, &storage, StorageKey::Subscription(i));
                if let Some(sub) = sub_opt {
                    if sub.status != subtrackr_types::SubscriptionStatus::Cancelled {
                        storage_persistent_set(
                            &env,
                            &storage,
                            StorageKey::UserPlanIndex(sub.subscriber.clone(), sub.plan_id),
                            sub.id,
                        );
                    }
                }
                i += 1;
            }
            return;
        }

        panic!("Unsupported migration path");
    }

    // ── Initialization (delegates to admin module) ──

    pub fn initialize(env: Env, proxy: Address, storage: Address, admin: Address) {
        proxy.require_auth();
        admin::initialize(&env, &storage, admin);
    }

    pub fn set_invoice_contract(env: Env, proxy: Address, storage: Address, invoice: Address) {
        proxy.require_auth();
        admin::set_invoice_contract(&env, &storage, invoice);
    }

    pub fn clear_invoice_contract(env: Env, proxy: Address, storage: Address) {
        proxy.require_auth();
        admin::clear_invoice_contract(&env, &storage);
    }

    // ── Oracle Integration (delegates to admin module) ──

    pub fn set_oracle_contract(env: Env, proxy: Address, storage: Address, oracle: Address) {
        proxy.require_auth();
        admin::set_oracle_contract(&env, &storage, oracle);
    }

    pub fn clear_oracle_contract(env: Env, proxy: Address, storage: Address) {
        proxy.require_auth();
        admin::clear_oracle_contract(&env, &storage);
    }

    pub fn get_oracle_contract(env: Env, proxy: Address, storage: Address) -> Option<Address> {
        proxy.require_auth();
        admin::get_oracle_contract(&env, &storage)
    }

    pub fn set_price_bounds(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
        bounds: subtrackr_types::PriceBounds,
    ) {
        proxy.require_auth();
        admin::set_price_bounds(&env, &storage, &merchant, plan_id, bounds);
    }

    pub fn clear_price_bounds(env: Env, proxy: Address, storage: Address, merchant: Address, plan_id: u64) {
        proxy.require_auth();
        admin::clear_price_bounds(&env, &storage, &merchant, plan_id);
    }

    pub fn get_price_bounds(env: Env, proxy: Address, storage: Address, plan_id: u64) -> Option<subtrackr_types::PriceBounds> {
        proxy.require_auth();
        admin::get_price_bounds(&env, &storage, plan_id)
    }

    pub fn get_oracle_price(
        env: Env,
        proxy: Address,
        storage: Address,
        token: Symbol,
        quote: Symbol,
        ttl: u64,
    ) -> Result<i128, OracleError> {
        proxy.require_auth();
        admin::get_oracle_price(&env, &storage, token, quote, ttl)
    }

    pub fn set_token_symbol(
        env: Env,
        proxy: Address,
        storage: Address,
        admin_addr: Address,
        token: Address,
        symbol: Symbol,
    ) {
        proxy.require_auth();
        admin_addr.require_auth();
        admin::set_token_symbol(&env, &storage, token, symbol);
    }

    pub fn remove_token_symbol(env: Env, proxy: Address, storage: Address, admin_addr: Address, token: Address) {
        proxy.require_auth();
        admin_addr.require_auth();
        admin::remove_token_symbol(&env, &storage, token);
    }

    pub fn get_token_symbol(env: Env, proxy: Address, storage: Address, token: Address) -> Option<Symbol> {
        proxy.require_auth();
        admin::get_token_symbol(&env, &storage, token)
    }

    // ── Rate Limiting (delegates to admin module) ──

    pub fn set_rate_limit(
        env: Env,
        proxy: Address,
        storage: Address,
        function: String,
        min_interval_secs: u64,
    ) {
        proxy.require_auth();
        admin::set_rate_limit(&env, &storage, function, min_interval_secs);
    }

    pub fn remove_rate_limit(env: Env, proxy: Address, storage: Address, function: String) {
        proxy.require_auth();
        admin::remove_rate_limit(&env, &storage, function);
    }

    // ── Plan Management (delegates to plan module) ──

    pub fn create_plan(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        name: String,
        price: i128,
        token: Address,
        interval: subtrackr_types::Interval,
    ) -> u64 {
        proxy.require_auth();
        plan::create_plan(&env, &storage, &merchant, name, price, token, interval)
    }

    pub fn deactivate_plan(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
    ) {
        proxy.require_auth();
        plan::deactivate_plan(&env, &storage, &merchant, plan_id);
    }

    // ── Subscription Management (delegates to subscription_lifecycle module) ──

    pub fn subscribe(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        plan_id: u64,
    ) -> u64 {
        proxy.require_auth();
        subscription_lifecycle::subscribe(&env, &storage, &subscriber, plan_id)
    }

    pub fn cancel_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
    ) {
        proxy.require_auth();
        subscription_lifecycle::cancel_subscription(&env, &storage, &subscriber, subscription_id);
    }

    pub fn pause_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
    ) {
        proxy.require_auth();
        subscription_lifecycle::pause_subscription(&env, &storage, &subscriber, subscription_id);
    }

    pub fn pause_by_subscriber(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
        duration: u64,
    ) {
        proxy.require_auth();
        subscription_lifecycle::pause_by_subscriber(&env, &storage, &subscriber, subscription_id, duration);
    }

    pub fn resume_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
    ) {
        proxy.require_auth();
        subscription_lifecycle::resume_subscription(&env, &storage, &subscriber, subscription_id);
    }

    // ── Payment Processing (delegates to payment module) ──

    pub fn charge_subscription(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        payment::charge_subscription(&env, &storage, subscription_id);
    }

    pub fn request_refund(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        amount: i128,
    ) {
        proxy.require_auth();
        payment::request_refund(&env, &storage, subscription_id, amount);
    }

    pub fn approve_refund(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        payment::approve_refund(&env, &storage, subscription_id);
    }

    pub fn reject_refund(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        payment::reject_refund(&env, &storage, subscription_id);
    }

    // ── Subscription Transfer ──

    pub fn request_transfer(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        recipient: Address,
    ) {
        proxy.require_auth();
        let sub: subtrackr_types::Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        if sub.subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &sub.subscriber, "request_transfer");
        }
        sub.subscriber.require_auth();
        assert!(
            sub.status != subtrackr_types::SubscriptionStatus::Cancelled,
            "Subscription is cancelled"
        );
        assert!(sub.subscriber != recipient, "Cannot transfer to self");

        storage_instance_set(
            &env,
            &storage,
            StorageKey::PendingTransfer(subscription_id),
            recipient.clone(),
        );

        env.events().publish(
            (String::from_str(&env, "transfer_requested"), subscription_id),
            (sub.subscriber.clone(), recipient),
        );
    }

    pub fn accept_transfer(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        recipient: Address,
    ) {
        proxy.require_auth();
        if recipient != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &recipient, "accept_transfer");
        }
        recipient.require_auth();

        let mut sub: subtrackr_types::Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let pending_recipient: Address =
            storage_instance_get(&env, &storage, StorageKey::PendingTransfer(subscription_id))
                .expect("No pending transfer for this subscription");
        assert!(pending_recipient == recipient, "Transfer recipient mismatch");

        // Update user subscriptions lists
        let old_user_subs: Vec<u64> = storage_persistent_get(
            &env, &storage, StorageKey::UserSubscriptions(sub.subscriber.clone()),
        ).unwrap_or(Vec::new(&env));
        let mut new_list: Vec<u64> = Vec::new(&env);
        for id in old_user_subs.iter() {
            if id != subscription_id {
                new_list.push_back(id);
            }
        }
        storage_persistent_set(&env, &storage, StorageKey::UserSubscriptions(sub.subscriber.clone()), new_list);

        let mut rec_user_subs: Vec<u64> = storage_persistent_get(
            &env, &storage, StorageKey::UserSubscriptions(recipient.clone()),
        ).unwrap_or(Vec::new(&env));
        rec_user_subs.push_back(subscription_id);
        storage_persistent_set(&env, &storage, StorageKey::UserSubscriptions(recipient.clone()), rec_user_subs);

        // Update plan index mapping
        storage_persistent_remove(&env, &storage, StorageKey::UserPlanIndex(sub.subscriber.clone(), sub.plan_id));
        storage_persistent_set(&env, &storage, StorageKey::UserPlanIndex(recipient.clone(), sub.plan_id), sub.id);

        let old = sub.subscriber.clone();
        sub.subscriber = recipient.clone();
        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub);
        storage_instance_remove(&env, &storage, StorageKey::PendingTransfer(subscription_id));

        env.events().publish(
            (String::from_str(&env, "transfer_accepted"), subscription_id),
            (old, recipient),
        );
    }

    // ── Queries (delegates to respective modules) ──

    pub fn get_plan(env: Env, proxy: Address, storage: Address, plan_id: u64) -> subtrackr_types::Plan {
        proxy.require_auth();
        plan::get_plan(&env, &storage, plan_id)
    }

    pub fn get_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> subtrackr_types::Subscription {
        proxy.require_auth();
        subscription_lifecycle::get_subscription(&env, &storage, subscription_id)
    }

    pub fn get_user_subscriptions(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
    ) -> Vec<u64> {
        proxy.require_auth();
        subscription_lifecycle::get_user_subscriptions(&env, &storage, &subscriber)
    }

    pub fn get_merchant_plans(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
    ) -> Vec<u64> {
        proxy.require_auth();
        plan::get_merchant_plans(&env, &storage, &merchant)
    }

    pub fn get_plan_count(env: Env, proxy: Address, storage: Address) -> u64 {
        proxy.require_auth();
        plan::get_plan_count(&env, &storage)
    }

    pub fn get_subscription_count(env: Env, proxy: Address, storage: Address) -> u64 {
        proxy.require_auth();
        subscription_lifecycle::get_subscription_count(&env, &storage)
    }

    // ── Revenue Recognition API (unchanged, delegates to revenue module) ──

    pub fn set_revenue_rule(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
        method: revenue::RecognitionMethod,
        recognition_period: u64,
    ) {
        proxy.require_auth();
        merchant.require_auth();
        let plan: subtrackr_types::Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
            .expect("Plan not found");
        assert!(plan.merchant == merchant, "Only plan owner can set revenue rule");
        revenue::set_recognition_rule(
            &env, &storage,
            revenue::RevenueRecognitionRule { plan_id, method, recognition_period },
        );
    }

    pub fn recognize_revenue(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> revenue::Recognition {
        proxy.require_auth();
        let sub: subtrackr_types::Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");
        let plan: subtrackr_types::Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");
        let now = env.ledger().timestamp();
        revenue::recognize_revenue(&env, &storage, subscription_id, plan.merchant, now)
    }

    pub fn get_deferred_revenue(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant_id: Address,
    ) -> i128 {
        proxy.require_auth();
        revenue::get_deferred_revenue(&env, &storage, &merchant_id)
    }

    pub fn get_revenue_schedule(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> Option<revenue::RevenueSchedule> {
        proxy.require_auth();
        revenue::get_revenue_schedule(&env, &storage, subscription_id)
    }

    // ── Quota & Usage API (delegates to admin module) ──

    pub fn set_plan_quotas(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
        quotas: Vec<subtrackr_types::Quota>,
    ) {
        proxy.require_auth();
        admin::set_plan_quotas(&env, &storage, merchant, plan_id, quotas);
    }

    pub fn get_plan_quotas(
        env: Env,
        proxy: Address,
        storage: Address,
        plan_id: u64,
    ) -> Vec<subtrackr_types::Quota> {
        proxy.require_auth();
        admin::get_plan_quotas(&env, &storage, plan_id)
    }

    pub fn record_usage(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        metric: subtrackr_types::QuotaMetric,
        amount: u64,
    ) -> subtrackr_types::UsageRecord {
        proxy.require_auth();
        admin::record_usage(&env, &storage, subscription_id, metric, amount)
    }

    pub fn get_usage_record(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        metric: subtrackr_types::QuotaMetric,
    ) -> subtrackr_types::UsageRecord {
        proxy.require_auth();
        admin::get_usage_record(&env, &storage, subscription_id, metric)
    }

    pub fn check_quota(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        metric: subtrackr_types::QuotaMetric,
    ) -> subtrackr_types::QuotaStatus {
        proxy.require_auth();
        admin::check_quota(&env, &storage, subscription_id, metric)
    }
}
