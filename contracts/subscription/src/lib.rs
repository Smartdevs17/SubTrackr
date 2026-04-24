#![no_std]

use soroban_sdk::{token, Address, Env, IntoVal, String, TryFromVal, Val, Vec};
use subtrackr_types::{Interval, Plan, StorageKey, Subscription, SubscriptionStatus};

/// Billing interval in seconds.
const MAX_PAUSE_DURATION: u64 = 2_592_000; // 30 days

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

fn storage_instance_set<V: IntoVal<Env, Val>>(env: &Env, storage: &Address, key: StorageKey, value: V) {
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

fn storage_persistent_set<V: IntoVal<Env, Val>>(env: &Env, storage: &Address, key: StorageKey, value: V) {
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

fn get_admin(env: &Env, storage: &Address) -> Address {
    storage_instance_get(env, storage, StorageKey::Admin).expect("Admin not set")
}

fn enforce_rate_limit(env: &Env, storage: &Address, caller: &Address, function_name: &str) {
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
                (String::from_str(env, "rate_limit_violation"), caller.clone()),
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

fn check_and_resume_internal(env: &Env, sub: &mut Subscription) -> bool {
    if sub.status == SubscriptionStatus::Paused {
        let now = env.ledger().timestamp();
        if now >= sub.paused_at + sub.pause_duration {
            sub.status = SubscriptionStatus::Active;
            sub.paused_at = 0;
            sub.pause_duration = 0;
            return true;
        }
    }
    false
}

fn set_user_plan_index(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
    subscription_id: u64,
) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
        subscription_id,
    );
}

fn remove_user_plan_index(env: &Env, storage: &Address, subscriber: &Address, plan_id: u64) {
    storage_persistent_remove(env, storage, StorageKey::UserPlanIndex(subscriber.clone(), plan_id));
}

fn get_user_plan_index(env: &Env, storage: &Address, subscriber: &Address, plan_id: u64) -> Option<u64> {
    storage_persistent_get(env, storage, StorageKey::UserPlanIndex(subscriber.clone(), plan_id))
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation Contract
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

        // Ensure core keys exist before allowing upgrade/migration.
        let _admin: Address = get_admin(&env, &storage);
        let _plan_count: u64 =
            storage_instance_get(&env, &storage, StorageKey::PlanCount).unwrap_or(0);
        let _sub_count: u64 =
            storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0);
    }

    /// Migrate storage from `from_version` to this implementation's `STORAGE_VERSION`.
    ///
    /// For v1 -> v2: build `UserPlanIndex` for all active/non-cancelled subscriptions.
    pub fn migrate(env: Env, proxy: Address, storage: Address, from_version: u32) {
        proxy.require_auth();
        if from_version == STORAGE_VERSION {
            return;
        }
        assert!(from_version < STORAGE_VERSION, "Unsupported migration path");

        if from_version == 1 {
            let sub_count: u64 = storage_instance_get(&env, &storage, StorageKey::SubscriptionCount)
                .unwrap_or(0);
            let mut i: u64 = 1;
            while i <= sub_count {
                let sub_opt: Option<Subscription> =
                    storage_persistent_get(&env, &storage, StorageKey::Subscription(i));
                if let Some(sub) = sub_opt {
                    if sub.status != SubscriptionStatus::Cancelled {
                        set_user_plan_index(&env, &storage, &sub.subscriber, sub.plan_id, sub.id);
                    }
                }
                i += 1;
            }
            return;
        }

        panic!("Unsupported migration path");
    }

    // ── Initialization ──

    pub fn initialize(env: Env, proxy: Address, storage: Address, admin: Address) {
        proxy.require_auth();
        admin.require_auth();

        storage_instance_set(&env, &storage, StorageKey::Admin, admin);
        storage_instance_set(&env, &storage, StorageKey::PlanCount, 0u64);
        storage_instance_set(&env, &storage, StorageKey::SubscriptionCount, 0u64);
    }

    // ── Rate Limiting Admin ──

    pub fn set_rate_limit(
        env: Env,
        proxy: Address,
        storage: Address,
        function: String,
        min_interval_secs: u64,
    ) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        admin.require_auth();
        storage_instance_set(
            &env,
            &storage,
            StorageKey::RateLimit(function),
            min_interval_secs,
        );
    }

    pub fn remove_rate_limit(env: Env, proxy: Address, storage: Address, function: String) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        admin.require_auth();
        storage_instance_remove(&env, &storage, StorageKey::RateLimit(function));
    }

    // ── Plan Management ──

    pub fn create_plan(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        name: String,
        price: i128,
        token: Address,
        interval: Interval,
    ) -> u64 {
        proxy.require_auth();
        if merchant != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &merchant, "create_plan");
        }
        merchant.require_auth();
        assert!(price > 0, "Price must be positive");

        let mut count: u64 = storage_instance_get(&env, &storage, StorageKey::PlanCount).unwrap_or(0);
        count += 1;

        let plan = Plan {
            id: count,
            merchant: merchant.clone(),
            name,
            price,
            token,
            interval,
            active: true,
            subscriber_count: 0,
            created_at: env.ledger().timestamp(),
        };

        storage_persistent_set(&env, &storage, StorageKey::Plan(count), plan.clone());
        storage_instance_set(&env, &storage, StorageKey::PlanCount, count);

        let mut merchant_plans: Vec<u64> = storage_persistent_get(
            &env,
            &storage,
            StorageKey::MerchantPlans(merchant.clone()),
        )
        .unwrap_or(Vec::new(&env));
        merchant_plans.push_back(count);
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::MerchantPlans(merchant),
            merchant_plans,
        );

        count
    }

    pub fn deactivate_plan(env: Env, proxy: Address, storage: Address, merchant: Address, plan_id: u64) {
        proxy.require_auth();
        if merchant != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &merchant, "deactivate_plan");
        }
        merchant.require_auth();

        let mut plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
            .expect("Plan not found");

        assert!(plan.merchant == merchant, "Only plan owner can deactivate");
        plan.active = false;

        storage_persistent_set(&env, &storage, StorageKey::Plan(plan_id), plan);
    }

    // ── Subscription Management ──

    pub fn subscribe(env: Env, proxy: Address, storage: Address, subscriber: Address, plan_id: u64) -> u64 {
        proxy.require_auth();
        if subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &subscriber, "subscribe");
        }
        subscriber.require_auth();

        let mut plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
            .expect("Plan not found");
        assert!(plan.active, "Plan is not active");
        assert!(
            plan.merchant != subscriber,
            "Merchant cannot self-subscribe"
        );

        if let Some(existing_id) = get_user_plan_index(&env, &storage, &subscriber, plan_id) {
            let existing_sub: Subscription =
                storage_persistent_get(&env, &storage, StorageKey::Subscription(existing_id))
                    .expect("Subscription not found");
            if existing_sub.status != SubscriptionStatus::Cancelled {
                panic!("Already subscribed to this plan");
            }
        }

        let mut sub_count: u64 =
            storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0);
        sub_count += 1;

        let now = env.ledger().timestamp();

        let subscription = Subscription {
            id: sub_count,
            plan_id,
            subscriber: subscriber.clone(),
            status: SubscriptionStatus::Active,
            started_at: now,
            last_charged_at: now,
            next_charge_at: now + plan.interval.seconds(),
            total_paid: 0,
            total_gas_spent: 0,
            charge_count: 0,
            paused_at: 0,
            pause_duration: 0,
            refund_requested_amount: 0,
        };

        storage_persistent_set(&env, &storage, StorageKey::Subscription(sub_count), subscription);
        storage_instance_set(&env, &storage, StorageKey::SubscriptionCount, sub_count);

        let mut user_subs: Vec<u64> = storage_persistent_get(
            &env,
            &storage,
            StorageKey::UserSubscriptions(subscriber.clone()),
        )
        .unwrap_or(Vec::new(&env));
        user_subs.push_back(sub_count);
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::UserSubscriptions(subscriber.clone()),
            user_subs,
        );

        // Index for quick duplicate checks
        set_user_plan_index(&env, &storage, &subscriber, plan_id, sub_count);

        plan.subscriber_count += 1;
        storage_persistent_set(&env, &storage, StorageKey::Plan(plan_id), plan);

        sub_count
    }

    pub fn cancel_subscription(env: Env, proxy: Address, storage: Address, subscriber: Address, subscription_id: u64) {
        proxy.require_auth();
        if subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &subscriber, "cancel_subscription");
        }
        subscriber.require_auth();

        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        assert!(sub.subscriber == subscriber, "Only subscriber can cancel");
        assert!(
            sub.status == SubscriptionStatus::Active || sub.status == SubscriptionStatus::Paused,
            "Subscription not active"
        );

        sub.status = SubscriptionStatus::Cancelled;
        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub.clone());

        // Remove index
        remove_user_plan_index(&env, &storage, &subscriber, sub.plan_id);

        let mut plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");
        if plan.subscriber_count > 0 {
            plan.subscriber_count -= 1;
        }
        storage_persistent_set(&env, &storage, StorageKey::Plan(sub.plan_id), plan);
    }

    pub fn pause_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
    ) {
        proxy.require_auth();
        if subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &subscriber, "pause_subscription");
        }
        Self::pause_by_subscriber(
            env,
            proxy,
            storage,
            subscriber,
            subscription_id,
            MAX_PAUSE_DURATION,
        );
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
        if subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &subscriber, "pause_by_subscriber");
        }
        subscriber.require_auth();

        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        assert!(sub.subscriber == subscriber, "Only subscriber can pause");
        assert!(
            sub.status == SubscriptionStatus::Active,
            "Only active subscriptions can be paused"
        );
        assert!(
            duration <= MAX_PAUSE_DURATION,
            "Pause duration exceeds limit"
        );

        sub.status = SubscriptionStatus::Paused;
        sub.paused_at = env.ledger().timestamp();
        sub.pause_duration = duration;

        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub.clone());

        env.events().publish(
            (String::from_str(&env, "subscription_paused"), subscriber),
            (subscription_id, sub.paused_at, duration),
        );
    }

    pub fn resume_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
    ) {
        proxy.require_auth();
        if subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &subscriber, "resume_subscription");
        }
        subscriber.require_auth();

        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        assert!(sub.subscriber == subscriber, "Only subscriber can resume");
        assert!(
            sub.status == SubscriptionStatus::Paused
                || check_and_resume_internal(&env, &mut sub),
            "Only paused subscriptions can be resumed"
        );

        let now = env.ledger().timestamp();
        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");

        sub.status = SubscriptionStatus::Active;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.paused_at = 0;
        sub.pause_duration = 0;

        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub);

        env.events().publish(
            (String::from_str(&env, "subscription_resumed"), subscriber),
            subscription_id,
        );
    }

    // ── Payment Processing ──

    pub fn charge_subscription(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        if sub.subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &sub.subscriber, "charge_subscription");
        }

        sub.subscriber.require_auth();

        if check_and_resume_internal(&env, &mut sub) {
            storage_persistent_set(
                &env,
                &storage,
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

        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");

        token::Client::new(&env, &plan.token).transfer(&sub.subscriber, &plan.merchant, &plan.price);

        sub.last_charged_at = now;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.total_paid += plan.price;
        sub.total_gas_spent += 100_000;
        sub.charge_count += 1;

        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub.clone());

        env.events().publish(
            (String::from_str(&env, "subscription_charged"), subscription_id),
            (sub.subscriber.clone(), plan.price, 100_000u64, now),
        );
    }

    pub fn request_refund(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        amount: i128,
    ) {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        if sub.subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &sub.subscriber, "request_refund");
        }

        sub.subscriber.require_auth();

        assert!(amount > 0, "Refund amount must be positive");
        assert!(
            amount <= sub.total_paid,
            "Refund amount cannot exceed total paid"
        );

        sub.refund_requested_amount = amount;
        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub.clone());

        env.events().publish(
            (String::from_str(&env, "refund_requested"), subscription_id),
            (sub.subscriber.clone(), amount),
        );
    }

    pub fn approve_refund(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let admin = get_admin(&env, &storage);
        admin.require_auth();

        let amount = sub.refund_requested_amount;
        assert!(amount > 0, "No pending refund request");

        let _plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");

        sub.total_paid -= amount;
        sub.refund_requested_amount = 0;

        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub.clone());

        env.events().publish(
            (String::from_str(&env, "refund_approved"), subscription_id),
            (sub.subscriber.clone(), amount),
        );
    }

    pub fn reject_refund(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let admin = get_admin(&env, &storage);
        admin.require_auth();

        assert!(sub.refund_requested_amount > 0, "No pending refund request");
        sub.refund_requested_amount = 0;

        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub.clone());

        env.events().publish(
            (String::from_str(&env, "refund_rejected"), subscription_id),
            sub.subscriber.clone(),
        );
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
        let sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        if sub.subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &sub.subscriber, "request_transfer");
        }

        sub.subscriber.require_auth();
        assert!(
            sub.status != SubscriptionStatus::Cancelled,
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

        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let pending_recipient: Address =
            storage_instance_get(&env, &storage, StorageKey::PendingTransfer(subscription_id))
                .expect("No pending transfer for this subscription");
        assert!(
            pending_recipient == recipient,
            "Transfer recipient mismatch"
        );

        let old_user_subs: Vec<u64> = storage_persistent_get(
            &env,
            &storage,
            StorageKey::UserSubscriptions(sub.subscriber.clone()),
        )
        .unwrap_or(Vec::new(&env));
        let mut new_list: Vec<u64> = Vec::new(&env);
        for id in old_user_subs.iter() {
            if id != subscription_id {
                new_list.push_back(id);
            }
        }
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::UserSubscriptions(sub.subscriber.clone()),
            new_list,
        );

        let mut rec_user_subs: Vec<u64> = storage_persistent_get(
            &env,
            &storage,
            StorageKey::UserSubscriptions(recipient.clone()),
        )
        .unwrap_or(Vec::new(&env));
        rec_user_subs.push_back(subscription_id);
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::UserSubscriptions(recipient.clone()),
            rec_user_subs,
        );

        // Update index mapping
        remove_user_plan_index(&env, &storage, &sub.subscriber, sub.plan_id);
        set_user_plan_index(&env, &storage, &recipient, sub.plan_id, sub.id);

        let old = sub.subscriber.clone();
        sub.subscriber = recipient.clone();
        storage_persistent_set(&env, &storage, StorageKey::Subscription(subscription_id), sub);

        storage_instance_remove(&env, &storage, StorageKey::PendingTransfer(subscription_id));

        env.events().publish(
            (String::from_str(&env, "transfer_accepted"), subscription_id),
            (old, recipient),
        );
    }

    // ── Queries ──

    pub fn get_plan(env: Env, proxy: Address, storage: Address, plan_id: u64) -> Plan {
        proxy.require_auth();
        storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id)).expect("Plan not found")
    }

    pub fn get_subscription(env: Env, proxy: Address, storage: Address, subscription_id: u64) -> Subscription {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        check_and_resume_internal(&env, &mut sub);
        sub
    }

    pub fn get_user_subscriptions(env: Env, proxy: Address, storage: Address, subscriber: Address) -> Vec<u64> {
        proxy.require_auth();
        storage_persistent_get(&env, &storage, StorageKey::UserSubscriptions(subscriber))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_merchant_plans(env: Env, proxy: Address, storage: Address, merchant: Address) -> Vec<u64> {
        proxy.require_auth();
        storage_persistent_get(&env, &storage, StorageKey::MerchantPlans(merchant)).unwrap_or(Vec::new(&env))
    }

    pub fn get_plan_count(env: Env, proxy: Address, storage: Address) -> u64 {
        proxy.require_auth();
        storage_instance_get(&env, &storage, StorageKey::PlanCount).unwrap_or(0)
    }

    pub fn get_subscription_count(env: Env, proxy: Address, storage: Address) -> u64 {
        proxy.require_auth();
        storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0)
    }
}
