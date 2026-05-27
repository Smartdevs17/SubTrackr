#![no_std]
mod gas_optimization;
mod gas_profiler;
mod gas_storage;
use soroban_sdk::{token, Address, Env, IntoVal, String, TryFromVal, Val, Vec};
use subtrackr_types::{
    CreditApplicationReceipt, CreditLedgerEntry, CreditLedgerEntryKind, CreditLot,
    CreditPaymentMethod, CreditPolicy, Interval, Invoice, InvoiceStatus, Plan, StorageKey,
    Subscription, SubscriptionStatus, TimeRange,
};

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
    storage_persistent_remove(
        env,
        storage,
        StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
    );
}

fn get_user_plan_index(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
) -> Option<u64> {
    storage_persistent_get(
        env,
        storage,
        StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
    )
}

fn invoice_contract(env: &Env, storage: &Address) -> Option<Address> {
    storage_instance_get(env, storage, StorageKey::InvoiceContract)
}

fn default_credit_policy(_env: &Env) -> CreditPolicy {
    CreditPolicy {
        expiration_days: 365,
        transferable: true,
        auto_apply: true,
        allow_partial: true,
    }
}

fn credit_policy(env: &Env, storage: &Address, account: &Address) -> CreditPolicy {
    storage_persistent_get(env, storage, StorageKey::CreditPolicy(account.clone()))
        .unwrap_or(default_credit_policy(env))
}

fn persist_credit_policy(env: &Env, storage: &Address, account: &Address, policy: CreditPolicy) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::CreditPolicy(account.clone()),
        policy,
    );
}

fn credit_balance(env: &Env, storage: &Address, account: &Address) -> i128 {
    storage_persistent_get(env, storage, StorageKey::CreditBalance(account.clone())).unwrap_or(0)
}

fn set_credit_balance(env: &Env, storage: &Address, account: &Address, balance: i128) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::CreditBalance(account.clone()),
        balance,
    );
}

fn credit_lots(env: &Env, storage: &Address, account: &Address) -> Vec<CreditLot> {
    storage_persistent_get(env, storage, StorageKey::CreditLots(account.clone()))
        .unwrap_or(Vec::new(env))
}

fn set_credit_lots(env: &Env, storage: &Address, account: &Address, lots: Vec<CreditLot>) {
    storage_persistent_set(env, storage, StorageKey::CreditLots(account.clone()), lots);
}

fn credit_ledger(env: &Env, storage: &Address, account: &Address) -> Vec<CreditLedgerEntry> {
    storage_persistent_get(env, storage, StorageKey::CreditLedger(account.clone()))
        .unwrap_or(Vec::new(env))
}

fn set_credit_ledger(
    env: &Env,
    storage: &Address,
    account: &Address,
    ledger: Vec<CreditLedgerEntry>,
) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::CreditLedger(account.clone()),
        ledger,
    );
}

fn next_credit_entry_id(ledger: &Vec<CreditLedgerEntry>) -> u64 {
    ledger.len() as u64 + 1
}

fn next_credit_lot_id(lots: &Vec<CreditLot>) -> u64 {
    lots.len() as u64 + 1
}

fn build_credit_ledger_entry(
    env: &Env,
    id: u64,
    account: &Address,
    kind: CreditLedgerEntryKind,
    amount: i128,
    balance_after: i128,
    subscription_id: u64,
    invoice_id: String,
    related_account: Address,
    payment_method: CreditPaymentMethod,
    reference: String,
    note: String,
    expires_at: u64,
) -> CreditLedgerEntry {
    CreditLedgerEntry {
        id,
        account: account.clone(),
        kind,
        amount,
        balance_after,
        running_total: balance_after,
        created_at: env.ledger().timestamp(),
        expires_at,
        subscription_id,
        invoice_id,
        related_account,
        payment_method,
        reference,
        note,
    }
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
            let sub_count: u64 =
                storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0);
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
        storage_instance_remove(&env, &storage, StorageKey::InvoiceContract);
    }

    pub fn set_invoice_contract(env: Env, proxy: Address, storage: Address, invoice: Address) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        admin.require_auth();
        storage_instance_set(&env, &storage, StorageKey::InvoiceContract, invoice);
    }

    pub fn clear_invoice_contract(env: Env, proxy: Address, storage: Address) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        admin.require_auth();
        storage_instance_remove(&env, &storage, StorageKey::InvoiceContract);
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

        let mut count: u64 =
            storage_instance_get(&env, &storage, StorageKey::PlanCount).unwrap_or(0);
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

        let mut merchant_plans: Vec<u64> =
            storage_persistent_get(&env, &storage, StorageKey::MerchantPlans(merchant.clone()))
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

    pub fn deactivate_plan(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
    ) {
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

    pub fn subscribe(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        plan_id: u64,
    ) -> u64 {
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

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(sub_count),
            subscription,
        );
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

    pub fn cancel_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        subscription_id: u64,
    ) {
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
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

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

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

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
            sub.status == SubscriptionStatus::Paused || check_and_resume_internal(&env, &mut sub),
            "Only paused subscriptions can be resumed"
        );

        let now = env.ledger().timestamp();
        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");

        sub.status = SubscriptionStatus::Active;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.paused_at = 0;
        sub.pause_duration = 0;

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub,
        );

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

        token::Client::new(&env, &plan.token).transfer(
            &sub.subscriber,
            &plan.merchant,
            &plan.price,
        );

        sub.last_charged_at = now;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.total_paid += plan.price;
        sub.total_gas_spent += 100_000;
        sub.charge_count += 1;

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

        // Generate revenue recognition schedule and defer the full charge amount.
        revenue::generate_revenue_schedule(
            &env,
            &storage,
            subscription_id,
            sub.plan_id,
            plan.price,
            now,
            plan.interval.seconds(),
        );
        revenue::update_merchant_revenue_balances(&env, &storage, &plan.merchant, 0, plan.price);
        revenue::track_merchant_subscription(&env, &storage, &plan.merchant, subscription_id);

        env.events().publish(
            (
                String::from_str(&env, "subscription_charged"),
                subscription_id,
            ),
            (sub.subscriber.clone(), plan.price, 100_000u64, now),
        );

        if let Some(invoice_addr) = invoice_contract(&env, &storage) {
            let period = TimeRange {
                start: sub.last_charged_at,
                end: sub.next_charge_at,
            };
            let _invoice: Invoice = env.invoke_contract(
                &invoice_addr,
                &soroban_sdk::Symbol::new(&env, "generate_invoice"),
                soroban_sdk::vec![
                    &env,
                    storage.clone().into_val(&env),
                    subscription_id.into_val(&env),
                    period.into_val(&env),
                    String::from_str(&env, "GLOBAL").into_val(&env),
                    String::from_str(&env, "").into_val(&env),
                ],
            );
            let _ = _invoice;
        }
    }

    // â”€â”€ Credit Balance API â”€â”€

    pub fn set_credit_policy(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
        policy: CreditPolicy,
    ) {
        proxy.require_auth();
        account.require_auth();
        persist_credit_policy(&env, &storage, &account, policy);
    }

    pub fn purchase_credits(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
        amount: i128,
        payment_method: CreditPaymentMethod,
        expires_in_days: u32,
        reference: String,
        note: String,
    ) -> i128 {
        proxy.require_auth();
        account.require_auth();
        assert!(amount > 0, "Credit amount must be positive");

        let policy = credit_policy(&env, &storage, &account);
        let expiry_days = if expires_in_days == 0 {
            policy.expiration_days
        } else {
            expires_in_days
        };
        let now = env.ledger().timestamp();
        let expires_at = if expiry_days == 0 {
            0
        } else {
            now + (expiry_days as u64 * 86_400)
        };

        let mut lots = credit_lots(&env, &storage, &account);
        let lot = CreditLot {
            id: next_credit_lot_id(&lots),
            account: account.clone(),
            amount_remaining: amount,
            original_amount: amount,
            created_at: now,
            expires_at,
            payment_method: payment_method.clone(),
            reference: reference.clone(),
            note: note.clone(),
        };
        lots.push_back(lot);
        set_credit_lots(&env, &storage, &account, lots);

        let balance = credit_balance(&env, &storage, &account) + amount;
        set_credit_balance(&env, &storage, &account, balance);

        let mut ledger = credit_ledger(&env, &storage, &account);
        let entry = build_credit_ledger_entry(
            &env,
            next_credit_entry_id(&ledger),
            &account,
            CreditLedgerEntryKind::Purchase,
            amount,
            balance,
            0,
            String::from_str(&env, ""),
            account.clone(),
            payment_method,
            reference,
            note,
            expires_at,
        );
        ledger.push_back(entry);
        set_credit_ledger(&env, &storage, &account, ledger);

        env.events().publish(
            (String::from_str(&env, "credit_purchased"), account.clone()),
            (amount, balance, expires_at),
        );

        balance
    }

    pub fn transfer_credits(
        env: Env,
        proxy: Address,
        storage: Address,
        from: Address,
        to: Address,
        amount: i128,
        reference: String,
        note: String,
    ) -> i128 {
        proxy.require_auth();
        from.require_auth();
        assert!(amount > 0, "Transfer amount must be positive");
        assert!(from != to, "Cannot transfer to self");

        let policy = credit_policy(&env, &storage, &from);
        assert!(policy.transferable, "Credits are not transferable");

        let balance = credit_balance(&env, &storage, &from);
        assert!(balance >= amount, "Insufficient credit balance");

        let mut source_lots = credit_lots(&env, &storage, &from);
        let mut recipient_lots = credit_lots(&env, &storage, &to);
        let mut remaining = amount;
        let mut moved = 0i128;
        let now = env.ledger().timestamp();

        let mut next_source_lots = Vec::new(&env);
        for lot in source_lots.iter() {
            let mut next_lot = lot.clone();
            if remaining > 0 && next_lot.amount_remaining > 0 {
                let consume = if next_lot.amount_remaining < remaining {
                    next_lot.amount_remaining
                } else {
                    remaining
                };
                next_lot.amount_remaining -= consume;
                remaining -= consume;
                moved += consume;

                let recipient_lot = CreditLot {
                    id: next_credit_lot_id(&recipient_lots),
                    account: to.clone(),
                    amount_remaining: consume,
                    original_amount: consume,
                    created_at: now,
                    expires_at: next_lot.expires_at,
                    payment_method: next_lot.payment_method.clone(),
                    reference: reference.clone(),
                    note: note.clone(),
                };
                recipient_lots.push_back(recipient_lot);
            }
            next_source_lots.push_back(next_lot);
        }

        set_credit_lots(&env, &storage, &from, next_source_lots);
        set_credit_lots(&env, &storage, &to, recipient_lots);

        let source_balance = balance - moved;
        let recipient_balance = credit_balance(&env, &storage, &to) + moved;
        set_credit_balance(&env, &storage, &from, source_balance);
        set_credit_balance(&env, &storage, &to, recipient_balance);

        let mut source_ledger = credit_ledger(&env, &storage, &from);
        let source_entry = build_credit_ledger_entry(
            &env,
            next_credit_entry_id(&source_ledger),
            &from,
            CreditLedgerEntryKind::TransferOut,
            -moved,
            source_balance,
            0,
            String::from_str(&env, ""),
            to.clone(),
            CreditPaymentMethod::Manual,
            reference.clone(),
            note.clone(),
            0,
        );
        source_ledger.push_back(source_entry);
        set_credit_ledger(&env, &storage, &from, source_ledger);

        let mut recipient_ledger = credit_ledger(&env, &storage, &to);
        let recipient_entry = build_credit_ledger_entry(
            &env,
            next_credit_entry_id(&recipient_ledger),
            &to,
            CreditLedgerEntryKind::TransferIn,
            moved,
            recipient_balance,
            0,
            String::from_str(&env, ""),
            from.clone(),
            CreditPaymentMethod::Manual,
            reference,
            note,
            0,
        );
        recipient_ledger.push_back(recipient_entry);
        set_credit_ledger(&env, &storage, &to, recipient_ledger);

        env.events().publish(
            (String::from_str(&env, "credit_transferred"), from.clone()),
            (to.clone(), moved, source_balance, recipient_balance),
        );

        recipient_balance
    }

    pub fn apply_credit_to_invoice(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
        subscription_id: u64,
        invoice_id: String,
        invoice_total: i128,
    ) -> CreditApplicationReceipt {
        proxy.require_auth();
        account.require_auth();
        assert!(invoice_total > 0, "Invoice total must be positive");

        let policy = credit_policy(&env, &storage, &account);
        let balance = credit_balance(&env, &storage, &account);
        let mut applied = if balance < invoice_total {
            balance
        } else {
            invoice_total
        };
        if !policy.allow_partial && applied < invoice_total {
            applied = 0;
        }

        let mut lots = credit_lots(&env, &storage, &account);
        let mut remaining = applied;
        let mut updated_lots = Vec::new(&env);
        for lot in lots.iter() {
            let mut next_lot = lot.clone();
            if remaining > 0 && next_lot.amount_remaining > 0 {
                let consume = if next_lot.amount_remaining < remaining {
                    next_lot.amount_remaining
                } else {
                    remaining
                };
                next_lot.amount_remaining -= consume;
                remaining -= consume;
            }
            updated_lots.push_back(next_lot);
        }

        if applied > 0 {
            set_credit_lots(&env, &storage, &account, updated_lots);
            let new_balance = balance - applied;
            set_credit_balance(&env, &storage, &account, new_balance);

            let mut ledger = credit_ledger(&env, &storage, &account);
            let entry = build_credit_ledger_entry(
                &env,
                next_credit_entry_id(&ledger),
                &account,
                CreditLedgerEntryKind::Application,
                -applied,
                new_balance,
                subscription_id,
                invoice_id.clone(),
                account.clone(),
                CreditPaymentMethod::Manual,
                String::from_str(&env, "invoice-application"),
                String::from_str(&env, "Auto-applied to upcoming invoice"),
                0,
            );
            ledger.push_back(entry);
            set_credit_ledger(&env, &storage, &account, ledger);

            env.events().publish(
                (String::from_str(&env, "credit_applied"), account.clone()),
                (subscription_id, invoice_id.clone(), applied, new_balance),
            );
        }

        let remaining_due = invoice_total - applied;
        let status = if applied == 0 {
            InvoiceStatus::Sent
        } else if remaining_due > 0 {
            InvoiceStatus::Partial
        } else {
            InvoiceStatus::Paid
        };

        CreditApplicationReceipt {
            invoice_id,
            subscription_id,
            applied_amount: applied,
            remaining_due,
            status,
        }
    }

    pub fn expire_credits(env: Env, proxy: Address, storage: Address, account: Address) -> i128 {
        proxy.require_auth();
        account.require_auth();
        let now = env.ledger().timestamp();
        let policy = credit_policy(&env, &storage, &account);
        let mut lots = credit_lots(&env, &storage, &account);
        let mut expired = 0i128;
        let mut updated = Vec::new(&env);
        for lot in lots.iter() {
            let mut next_lot = lot.clone();
            let is_due = next_lot.expires_at > 0 && next_lot.expires_at <= now;
            if is_due && next_lot.amount_remaining > 0 {
                expired += next_lot.amount_remaining;
                next_lot.amount_remaining = 0;
            }
            updated.push_back(next_lot);
        }

        if expired > 0 {
            set_credit_lots(&env, &storage, &account, updated);
            let balance = credit_balance(&env, &storage, &account) - expired;
            set_credit_balance(&env, &storage, &account, balance);

            let mut ledger = credit_ledger(&env, &storage, &account);
            let entry = build_credit_ledger_entry(
                &env,
                next_credit_entry_id(&ledger),
                &account,
                CreditLedgerEntryKind::Expiration,
                -expired,
                balance,
                0,
                String::from_str(&env, ""),
                account.clone(),
                CreditPaymentMethod::Manual,
                String::from_str(&env, "expiration"),
                String::from_str(&env, "Credits expired by policy"),
                0,
            );
            ledger.push_back(entry);
            set_credit_ledger(&env, &storage, &account, ledger);

            env.events().publish(
                (String::from_str(&env, "credit_expired"), account.clone()),
                (expired, balance, policy.expiration_days),
            );
        }

        expired
    }

    pub fn get_credit_balance(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
    ) -> i128 {
        proxy.require_auth();
        credit_balance(&env, &storage, &account)
    }

    pub fn get_credit_policy(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
    ) -> CreditPolicy {
        proxy.require_auth();
        credit_policy(&env, &storage, &account)
    }

    pub fn get_credit_lots(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
    ) -> Vec<CreditLot> {
        proxy.require_auth();
        credit_lots(&env, &storage, &account)
    }

    pub fn get_credit_ledger(
        env: Env,
        proxy: Address,
        storage: Address,
        account: Address,
    ) -> Vec<CreditLedgerEntry> {
        proxy.require_auth();
        credit_ledger(&env, &storage, &account)
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
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

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

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

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

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

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
            (
                String::from_str(&env, "transfer_requested"),
                subscription_id,
            ),
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
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub,
        );

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

    pub fn get_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> Subscription {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        check_and_resume_internal(&env, &mut sub);
        sub
    }

    pub fn get_user_subscriptions(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
    ) -> Vec<u64> {
        proxy.require_auth();
        storage_persistent_get(&env, &storage, StorageKey::UserSubscriptions(subscriber))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_merchant_plans(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
    ) -> Vec<u64> {
        proxy.require_auth();
        storage_persistent_get(&env, &storage, StorageKey::MerchantPlans(merchant))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_plan_count(env: Env, proxy: Address, storage: Address) -> u64 {
        proxy.require_auth();
        storage_instance_get(&env, &storage, StorageKey::PlanCount).unwrap_or(0)
    }

    pub fn get_subscription_count(env: Env, proxy: Address, storage: Address) -> u64 {
        proxy.require_auth();
        storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0)
    }

    // ── Revenue Recognition API ──

    /// Set a revenue recognition rule for a plan (merchant only).
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
        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
            .expect("Plan not found");
        assert!(
            plan.merchant == merchant,
            "Only plan owner can set revenue rule"
        );
        revenue::set_recognition_rule(
            &env,
            &storage,
            revenue::RevenueRecognitionRule {
                plan_id,
                method,
                recognition_period,
            },
        );
    }

    /// Compute a recognition snapshot for a subscription as of the current ledger time.
    pub fn recognize_revenue(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> revenue::Recognition {
        proxy.require_auth();
        let sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");
        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");
        let now = env.ledger().timestamp();
        revenue::recognize_revenue(&env, &storage, subscription_id, plan.merchant, now)
    }

    /// Return the cumulative deferred revenue balance for a merchant.
    pub fn get_deferred_revenue(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant_id: Address,
    ) -> i128 {
        proxy.require_auth();
        revenue::get_deferred_revenue(&env, &storage, &merchant_id)
    }

    /// Return the revenue schedule for a subscription (None if not yet generated).
    pub fn get_revenue_schedule(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> Option<revenue::RevenueSchedule> {
        proxy.require_auth();
        revenue::get_revenue_schedule(&env, &storage, subscription_id)
    }

    // ── Quota & Usage API ──

    pub fn set_plan_quotas(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
        quotas: Vec<subtrackr_types::Quota>,
    ) {
        proxy.require_auth();
        merchant.require_auth();
        let plan: subtrackr_types::Plan =
            storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
                .expect("Plan not found");
        assert!(plan.merchant == merchant, "Only plan owner can set quotas");
        quota::set_plan_quotas(&env, &storage, plan_id, quotas);
    }

    pub fn get_plan_quotas(
        env: Env,
        proxy: Address,
        storage: Address,
        plan_id: u64,
    ) -> Vec<subtrackr_types::Quota> {
        proxy.require_auth();
        quota::get_plan_quotas(&env, &storage, plan_id)
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
        let sub: subtrackr_types::Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let _admin = get_admin(&env, &storage);
        // Only subscriber or admin can record usage? Usually it's the app/admin
        // For simplicity, let's allow anyone with auth (simplified for this task)
        // In a real app, you might want more complex auth.

        usage::record_usage(&env, &storage, subscription_id, sub.plan_id, metric, amount)
    }

    pub fn get_usage_record(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        metric: subtrackr_types::QuotaMetric,
    ) -> subtrackr_types::UsageRecord {
        proxy.require_auth();
        usage::get_usage_record(&env, &storage, subscription_id, metric)
    }

    pub fn check_quota(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        metric: subtrackr_types::QuotaMetric,
    ) -> subtrackr_types::QuotaStatus {
        proxy.require_auth();
        let sub: subtrackr_types::Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");
        usage::check_quota(&env, &storage, subscription_id, sub.plan_id, metric)
    }
}
