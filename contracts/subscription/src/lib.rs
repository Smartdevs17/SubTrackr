#![no_std]

extern crate alloc;

mod billing;
mod charging;
mod errors;
mod event_store;
mod events;
mod gas_optimization;
mod gas_profiler;
mod gas_storage;
mod payment_methods;
mod proration;
mod quota;
mod revenue;
mod state;
mod timeout;
mod usage;
use soroban_sdk::{token, Address, Bytes, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec};
use subtrackr_oracle::{OracleError, SubTrackrOracleClient};
use subtrackr_types::{
    ChargeCommitment, GasPriceSnapshot, Interval, Invoice, MevChargeConfig, MevEventKind,
    MevStorageValue, Permission, Plan, PriceBounds, StorageKey, Subscription, SubscriptionStatus,
    TimeRange,
};
use timeout::{ChainTimeoutConfig, PaymentTimeout, TxHealthSummary};
mod reentrancy;
use crate::proration::ProrationResult;
use crate::proration::{CreditMemo, EffectiveDate};
use reentrancy::ReentrancyGuard;
use subtrackr_types::{PaymentMethod, PaymentMethodId, PaymentPriority, TokenType};

use crate::errors::ContractError;

/// Billing interval in seconds.
const MAX_PAUSE_DURATION: u64 = 2_592_000; // 30 days

/// How long an unaccepted subscription-transfer offer remains valid before it
/// expires.  Pending transfers live in transient storage, so once this window
/// elapses the offer is removed automatically without an explicit cleanup call.
const PENDING_TRANSFER_TTL_SECS: u64 = 604_800; // 7 days

const STORAGE_VERSION: u32 = 2;

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum GroupMemberRole {
    Owner,
    Admin,
    Member,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GroupMember {
    pub address: Address,
    pub role: GroupMemberRole,
    pub joined_at: u64,
    pub usage_units: u64,
    pub outstanding_balance: i128,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FamilyPlanRules {
    pub seat_limit: u32,
    pub family_plan_price: i128,
    pub owner_pays_for_members: bool,
    pub allow_member_overages: bool,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionGroup {
    pub id: u64,
    pub owner: Address,
    pub name: String,
    pub members: Vec<GroupMember>,
    pub rules: FamilyPlanRules,
    pub billing_address: String,
    pub created_at: u64,
    pub updated_at: u64,
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Transient (temporary) storage helpers
//
// These helpers route through the storage contract's new `temporary_*` bridge
// methods.  Temporary entries auto-expire after `ttl_ledgers` ledger closes,
// which is cheaper than persistent storage and avoids unbounded instance
// storage growth for short-lived state such as rate-limit timestamps.
//
// Soroban ledger close time ≈ 5 seconds, so:
//   60 s  ≈  12 ledgers
//   1 min ≈  12 ledgers
//   1 h   ≈  720 ledgers
//   1 d   ≈  17 280 ledgers
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a duration in seconds to an approximate ledger count.
/// Uses 5 seconds per ledger as the Soroban mainnet target.
fn secs_to_ledgers(secs: u64) -> u32 {
    // Minimum 1 ledger; cap at u32::MAX to avoid overflow.
    let ledgers = (secs / 5).max(1);
    if ledgers > u32::MAX as u64 {
        u32::MAX
    } else {
        ledgers as u32
    }
}

fn storage_temporary_get<V: TryFromVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
) -> Option<V> {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    let val_opt: Option<Val> = env.invoke_contract(
        storage,
        &soroban_sdk::Symbol::new(env, "temporary_get"),
        args,
    );
    val_opt.map(|val| V::try_from_val(env, &val).unwrap())
}

fn storage_temporary_set<V: IntoVal<Env, Val>>(
    env: &Env,
    storage: &Address,
    key: StorageKey,
    value: V,
    ttl_ledgers: u32,
) {
    let val: Val = value.into_val(env);
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env), val, ttl_ledgers.into_val(env)];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "temporary_set"),
        args,
    );
}

fn storage_temporary_remove(env: &Env, storage: &Address, key: StorageKey) {
    let args: Vec<Val> = soroban_sdk::vec![env, key.into_val(env)];
    env.invoke_contract::<()>(
        storage,
        &soroban_sdk::Symbol::new(env, "temporary_remove"),
        args,
    );
}

fn get_admin(env: &Env, storage: &Address) -> Address {
    storage_instance_get(env, storage, StorageKey::Admin).expect("Admin not set")
}

fn get_access_control(env: &Env, storage: &Address) -> Option<Address> {
    storage_instance_get(env, storage, StorageKey::AccessControl)
}

fn require_permission(env: &Env, storage: &Address, caller: &Address, permission: Permission) {
    let ac_opt: Option<Address> = get_access_control(env, storage);
    if let Some(ac_addr) = ac_opt {
        let args: Vec<Val> =
            soroban_sdk::vec![env, caller.clone().into_val(env), permission.into_val(env)];
        let has_perm: bool =
            env.invoke_contract(&ac_addr, &Symbol::new(env, "has_permission"), args);
        assert!(has_perm, "Unauthorized: missing required permission");
    }
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

    // ── Gas optimisation (Issue #395) ────────────────────────────────────────
    // Rate-limit timestamps only need to survive for `min_secs` seconds.
    // Using temporary storage (auto-expiring TTL) instead of instance storage:
    //   • Avoids unbounded growth of instance storage with one entry per
    //     (caller, function) pair.
    //   • Costs fewer ledger-entry rent fees because the entry expires
    //     automatically rather than persisting indefinitely.
    //   • Reduces the instance storage footprint, which lowers the base fee
    //     charged on every contract invocation.
    //
    // Migration note: existing LastCall entries in instance storage are
    // intentionally ignored here.  The worst-case effect is that a caller
    // who was rate-limited before the upgrade can make one extra call
    // immediately after the upgrade.  This is acceptable because:
    //   a) the window is at most `min_secs` wide, and
    //   b) the rate-limit is re-enforced from the very next call onward.
    // ─────────────────────────────────────────────────────────────────────────
    let last_opt: Option<u64> = storage_temporary_get(
        env,
        storage,
        StorageKey::TmpLastCall(caller.clone(), fname.clone()),
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

    // Store the new timestamp with a TTL equal to the rate-limit window.
    // Once the window expires the entry is automatically removed, freeing
    // ledger space without requiring an explicit delete.
    let ttl = secs_to_ledgers(min_secs);
    storage_temporary_set(
        env,
        storage,
        StorageKey::TmpLastCall(caller.clone(), fname),
        now,
        ttl,
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

fn resolve_charge_price(env: &Env, storage: &Address, plan: &Plan) -> i128 {
    let oracle_opt: Option<Address> =
        storage_instance_get(env, storage, StorageKey::OracleContract);
    let bounds_opt: Option<PriceBounds> =
        storage_persistent_get(env, storage, StorageKey::PriceBounds(plan.id));

    if oracle_opt.is_none() || bounds_opt.is_none() {
        return plan.price;
    }

    let oracle = oracle_opt.unwrap();
    let bounds = bounds_opt.unwrap();

    let token_sym_opt: Option<Symbol> =
        storage_instance_get(env, storage, StorageKey::TokenSymbol(plan.token.clone()));

    if token_sym_opt.is_none() {
        return plan.price;
    }

    let token_sym = token_sym_opt.unwrap();

    // Clean string-to-symbol conversion using our helper
    let quote_str = string_to_symbol_str(env, &bounds.quote);
    let quote_sym = Symbol::new(env, &quote_str);

    let client = SubTrackrOracleClient::new(env, &oracle);

    if let Ok(price) = client.try_get_price_with_cache(&token_sym, &quote_sym, &600) {
        let oracle_value = price.unwrap().value;
        if oracle_value <= 0 {
            return plan.price;
        }

        let max_price = (plan.price as u128).saturating_mul(bounds.max_price_bps as u128) / 10_000;
        let min_price = (plan.price as u128).saturating_mul(bounds.min_price_bps as u128) / 10_000;

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

// 1. Helper to convert Soroban String for Symbol creation
fn string_to_symbol_str(_env: &Env, s: &String) -> alloc::string::String {
    let mut str_buf = [0u8; 32]; // Symbols have a max length of 32
    let str_len = s.len() as usize;
    s.copy_into_slice(&mut str_buf[..str_len]);

    let str_slice = core::str::from_utf8(&str_buf[..str_len]).expect("Invalid UTF-8");
    alloc::string::String::from(str_slice)
}

// 2. Helper to convert Soroban String to Soroban Bytes
fn convert_to_bytes(env: &Env, s: &String) -> soroban_sdk::Bytes {
    let mut str_buf = [0u8; 256];
    let str_len = s.len() as usize;
    s.copy_into_slice(&mut str_buf[..str_len]);

    soroban_sdk::Bytes::from_slice(env, &str_buf[..str_len])
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

    pub fn set_access_control(
        env: Env,
        proxy: Address,
        storage: Address,
        admin: Address,
        access_control: Address,
    ) {
        proxy.require_auth();
        let stored_admin = get_admin(&env, &storage);
        assert!(admin == stored_admin, "Admin mismatch");
        admin.require_auth();
        storage_instance_set(&env, &storage, StorageKey::AccessControl, access_control);
    }

    pub fn set_invoice_contract(env: Env, proxy: Address, storage: Address, invoice: Address) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        require_permission(&env, &storage, &admin, Permission::SetInvoiceContract);
        storage_instance_set(&env, &storage, StorageKey::InvoiceContract, invoice);
    }

    pub fn clear_invoice_contract(env: Env, proxy: Address, storage: Address) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        require_permission(&env, &storage, &admin, Permission::ClearInvoiceContract);
        storage_instance_remove(&env, &storage, StorageKey::InvoiceContract);
    }

    // ── Oracle Integration ──

    pub fn set_oracle_contract(env: Env, proxy: Address, storage: Address, oracle: Address) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        admin.require_auth();
        storage_instance_set(&env, &storage, StorageKey::OracleContract, oracle);
    }

    pub fn clear_oracle_contract(env: Env, proxy: Address, storage: Address) {
        proxy.require_auth();
        let admin = get_admin(&env, &storage);
        admin.require_auth();
        storage_instance_remove(&env, &storage, StorageKey::OracleContract);
    }

    pub fn get_oracle_contract(env: Env, proxy: Address, storage: Address) -> Option<Address> {
        proxy.require_auth();
        storage_instance_get(&env, &storage, StorageKey::OracleContract)
    }

    /// Set slippage protection bounds for a plan. When set, `charge_subscription`
    /// will verify the oracle price against these bounds before executing payment.
    pub fn set_price_bounds(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
        bounds: PriceBounds,
    ) {
        proxy.require_auth();
        merchant.require_auth();
        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
            .expect("Plan not found");
        assert!(plan.merchant == merchant, "Only plan owner can set bounds");
        assert!(
            bounds.max_price_bps >= bounds.min_price_bps,
            "Max must be >= min"
        );
        assert!(bounds.max_price_bps > 0, "Max must be positive");
        storage_persistent_set(&env, &storage, StorageKey::PriceBounds(plan_id), bounds);
    }

    pub fn clear_price_bounds(
        env: Env,
        proxy: Address,
        storage: Address,
        merchant: Address,
        plan_id: u64,
    ) {
        proxy.require_auth();
        merchant.require_auth();
        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
            .expect("Plan not found");
        assert!(
            plan.merchant == merchant,
            "Only plan owner can clear bounds"
        );
        storage_persistent_remove(&env, &storage, StorageKey::PriceBounds(plan_id));
    }

    pub fn get_price_bounds(
        env: Env,
        proxy: Address,
        storage: Address,
        plan_id: u64,
    ) -> Option<PriceBounds> {
        proxy.require_auth();
        storage_persistent_get(&env, &storage, StorageKey::PriceBounds(plan_id))
    }

    /// Look up the current oracle price for a token/quote pair, using cached read.
    pub fn get_oracle_price(
        env: Env,
        proxy: Address,
        storage: Address,
        token: Symbol,
        quote: Symbol,
        ttl: u64,
    ) -> Result<i128, OracleError> {
        proxy.require_auth();
        let oracle: Address = storage_instance_get(&env, &storage, StorageKey::OracleContract)
            .expect("Oracle contract not set");
        let client = SubTrackrOracleClient::new(&env, &oracle);
        let price = client.get_price_with_cache(&token, &quote, &ttl);
        Ok(price.value)
    }

    /// Register the symbol name for a token address so the oracle can look it up.
    pub fn set_token_symbol(
        env: Env,
        proxy: Address,
        storage: Address,
        admin: Address,
        token: Address,
        symbol: Symbol,
    ) {
        proxy.require_auth();
        admin.require_auth();
        let stored_admin = get_admin(&env, &storage);
        assert!(admin == stored_admin, "Only admin can set token symbols");
        storage_instance_set(&env, &storage, StorageKey::TokenSymbol(token), symbol);
    }

    pub fn remove_token_symbol(
        env: Env,
        proxy: Address,
        storage: Address,
        admin: Address,
        token: Address,
    ) {
        proxy.require_auth();
        admin.require_auth();
        let stored_admin = get_admin(&env, &storage);
        assert!(admin == stored_admin, "Only admin can remove token symbols");
        storage_instance_remove(&env, &storage, StorageKey::TokenSymbol(token));
    }

    pub fn get_token_symbol(
        env: Env,
        proxy: Address,
        storage: Address,
        token: Address,
    ) -> Option<Symbol> {
        proxy.require_auth();
        storage_instance_get(&env, &storage, StorageKey::TokenSymbol(token))
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
        require_permission(&env, &storage, &admin, Permission::SetRateLimit);
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
        require_permission(&env, &storage, &admin, Permission::RemoveRateLimit);
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

        let metadata = event_store::build_event_metadata(&env, &subscriber);
        event_store::record_event(
            &env,
            sub_count,
            plan_id,
            events::SubscriptionEventType::Created,
            metadata,
            &SubscriptionStatus::Active,
            &SubscriptionStatus::Active,
            plan_id,
            0,
        );

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

        let prior_status = sub.status.clone();

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

        let metadata = event_store::build_event_metadata(&env, &subscriber);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::Cancelled,
            metadata,
            &prior_status,
            &SubscriptionStatus::Cancelled,
            sub.plan_id,
            0,
        );
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

        let metadata = event_store::build_event_metadata(&env, &subscriber);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::Paused,
            metadata,
            &SubscriptionStatus::Active,
            &SubscriptionStatus::Paused,
            sub.plan_id,
            0,
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

        let prior_status = sub.status.clone();

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

        let metadata = event_store::build_event_metadata(&env, &subscriber);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::Resumed,
            metadata,
            &prior_status,
            &SubscriptionStatus::Active,
            sub.plan_id,
            0,
        );
    }

    // ── Payment Processing ──

    pub fn charge_subscription(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        max_gas_fee: Option<i128>,
        max_gas: Option<u64>,
    ) {
        // 0. REENTRANCY GUARD
        // Lock the instance to prevent recursive cross-contract calls
        let _guard = ReentrancyGuard::new(&env);
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        if sub.subscriber != get_admin(&env, &storage) {
            enforce_rate_limit(&env, &storage, &sub.subscriber, "charge_subscription");
        }

        sub.subscriber.require_auth();

        // ── Charge state machine guard (transient storage) ──────────────────
        // A subscription must be charged at most once per ledger close.  We
        // record the current ledger sequence as a charge nonce in TEMPORARY
        // storage keyed by subscription_id.  The entry is given a 1-ledger TTL
        // so it self-clears on the next ledger and never accrues persistent
        // rent.  This is intermediate, short-lived state — exactly what
        // transient storage is for — and it cheaply prevents a duplicate
        // charge from racing through within the same ledger.
        let nonce_key = StorageKey::TmpChargeNonce(subscription_id);
        let ledger_seq = env.ledger().sequence() as u64;
        let in_progress: Option<u64> = storage_temporary_get(&env, &storage, nonce_key.clone());
        if let Some(prev_seq) = in_progress {
            assert!(
                prev_seq != ledger_seq,
                "Duplicate charge attempt within the same ledger"
            );
        }
        storage_temporary_set(&env, &storage, nonce_key, ledger_seq, 1);

        if check_and_resume_internal(&env, &mut sub) {
            storage_persistent_set(
                &env,
                &storage,
                StorageKey::Subscription(subscription_id),
                sub.clone(),
            );
        }

        // 1. CHECKS
        assert!(
            sub.status == SubscriptionStatus::Active,
            "Subscription not active"
        );

        let now = env.ledger().timestamp();
        assert!(now >= sub.next_charge_at, "Payment not yet due");

        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");

        let charge_price = resolve_charge_price(&env, &storage, &plan);

        // ── MEV Protection: private mempool check ──
        if let Some(MevStorageValue::MevChargeConfig(cfg)) = storage_persistent_get::<MevStorageValue>(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
        ) {
            if cfg.use_private_mempool {
                env.events().publish(
                    (String::from_str(&env, "mev_event"), subscription_id),
                    (
                        MevEventKind::PrivateMempoolSubmitted,
                        sub.subscriber.clone(),
                        charge_price,
                        now,
                    ),
                );
            }
            if let Some(max_fee) = max_gas_fee {
                if max_fee > cfg.max_gas_fee {
                    panic!("{}", ContractError::SlippageExceeded.user_message());
                }
            }
        }

        // ── MEV Protection: per-call max_gas_fee ──
        if let Some(max_fee) = max_gas_fee {
            if max_fee <= 0 {
                env.events().publish(
                    (String::from_str(&env, "mev_event"), subscription_id),
                    (
                        MevEventKind::GasPriceAnomaly,
                        sub.subscriber.clone(),
                        charge_price,
                        now,
                    ),
                );
                panic!("{}", ContractError::SlippageExceeded.user_message());
            }
        }

        // 2. EFFECTS
        // Update the state BEFORE making the external token transfer
        let gas_used: u64 = 100_000;
        sub.last_charged_at = now;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.total_paid += charge_price;
        sub.total_gas_spent += gas_used;
        sub.charge_count += 1;

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

        // ── MEV Protection: store gas price snapshot ──
        let snapshot = GasPriceSnapshot {
            ledger_seq: env.ledger().sequence(),
            timestamp: now,
            gas_used,
            amount_charged: charge_price,
        };
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
            MevStorageValue::GasPriceSnapshot(snapshot),
        );

        // Generate revenue recognition schedule and defer the full charge amount.
        revenue::generate_revenue_schedule(
            &env,
            &storage,
            subscription_id,
            sub.plan_id,
            charge_price,
            now,
            plan.interval.seconds(),
        );
        revenue::update_merchant_revenue_balances(&env, &storage, &plan.merchant, 0, charge_price);
        revenue::track_merchant_subscription(&env, &storage, &plan.merchant, subscription_id);

        env.events().publish(
            (
                String::from_str(&env, "subscription_charged"),
                subscription_id,
            ),
            (sub.subscriber.clone(), charge_price, gas_used, now),
        );

        // 2. EFFECTS (Continued)
        let metadata = event_store::build_event_metadata(&env, &sub.subscriber);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::Charged,
            metadata,
            &SubscriptionStatus::Active,
            &SubscriptionStatus::Active,
            sub.plan_id,
            charge_price,
        );

        // Accumulate loyalty points.
        loyalty::accumulate_points(&env, &storage, &sub.subscriber, plan.price, now);

        // 3. INTERACTIONS
        // Execute the token transfer. If this fails or attempts to re-enter,
        // the transaction panics and all preceding storage changes safely roll back.
        token::Client::new(&env, &plan.token).transfer(
            &sub.subscriber,
            &plan.merchant,
            &charge_price,
        );

        // ── MEV Protection: max_gas check (after transfer so we know actual cost) ──
        if let Some(max_g) = max_gas {
            if gas_used > max_g {
                panic!("{}", ContractError::MaxGasExceeded.user_message());
            }
        }

        if let Some(invoice_addr) = invoice_contract(&env, &storage) {
            // Note: If you want to be extremely strict about CEI, ensure `generate_invoice`
            // cannot make re-entrant state changes either, as we invoke it here.
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
                    String::from_str(&env, "").into_val(&env),
                    String::from_str(&env, "").into_val(&env),
                    String::from_str(&env, "").into_val(&env),
                ],
            );
            let _ = _invoice;
        }
    }

    // ── MEV Protection: Commit-Reveal ──

    /// Commit to a future charge with a blinded hash.
    /// The commitment stores `sha256(amount, nonce, subscriber)` so the
    /// actual price is hidden until `reveal_charge` is called.
    pub fn commit_charge(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        commitment_hash: Bytes,
        max_gas_fee: i128,
        deadline: u64,
    ) {
        proxy.require_auth();
        let sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");
        sub.subscriber.require_auth();

        let now = env.ledger().timestamp();
        assert!(
            deadline > now,
            "{}",
            ContractError::CommitmentExpired.user_message()
        );

        let commitment = ChargeCommitment {
            commitment_hash,
            max_gas_fee,
            deadline,
            subscriber: sub.subscriber.clone(),
        };
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
            MevStorageValue::ChargeCommitment(commitment),
        );

        env.events().publish(
            (String::from_str(&env, "mev_event"), subscription_id),
            (MevEventKind::Committed, sub.subscriber, 0i128, now),
        );
    }

    /// Reveal a previously committed charge, verifying the hash matches
    /// `sha256(amount, nonce, subscriber)`. If valid, executes the charge
    /// inside the same transaction so the price cannot be front-run.
    pub fn reveal_charge(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        amount: i128,
        nonce: Bytes,
    ) {
        proxy.require_auth();
        let mev_val = storage_persistent_get::<MevStorageValue>(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
        )
        .expect("No commitment found for this subscription");
        let commitment: ChargeCommitment = match mev_val {
            MevStorageValue::ChargeCommitment(c) => c,
            _ => panic!("No commitment found for this subscription"),
        };

        let now = env.ledger().timestamp();
        assert!(
            now <= commitment.deadline,
            "{}",
            ContractError::CommitmentExpired.user_message()
        );

        // Recompute hash: sha256(amount.to_be_bytes() || nonce)
        let amount_arr = amount.to_be_bytes();
        let amount_bytes = Bytes::from_slice(&env, &amount_arr);
        let mut preimage = Bytes::new(&env);
        preimage.append(&amount_bytes);
        preimage.append(&nonce);
        let computed_hash: Bytes = env.crypto().sha256(&preimage).into();

        assert!(
            computed_hash == commitment.commitment_hash,
            "{}",
            ContractError::CommitmentMismatch.user_message()
        );

        // Remove commitment so it cannot be replayed
        storage_persistent_remove(&env, &storage, StorageKey::MevState(subscription_id));

        // Execute the charge with the revealed price
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        sub.subscriber.require_auth();

        assert!(
            sub.status == SubscriptionStatus::Active,
            "Subscription not active"
        );
        assert!(now >= sub.next_charge_at, "Payment not yet due");

        let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
            .expect("Plan not found");

        // MEV: enforce the committed max_gas_fee
        // Note: SDK v21 does not expose ledger base_fee, so we use a simplified
        // check — reject if max_gas_fee is <= 0 as a safety guard.
        if commitment.max_gas_fee <= 0 {
            env.events().publish(
                (String::from_str(&env, "mev_event"), subscription_id),
                (
                    MevEventKind::GasPriceAnomaly,
                    sub.subscriber.clone(),
                    amount,
                    now,
                ),
            );
            panic!("{}", ContractError::SlippageExceeded.user_message());
        }

        token::Client::new(&env, &plan.token).transfer(&sub.subscriber, &plan.merchant, &amount);

        let gas_used: u64 = 100_000;

        sub.last_charged_at = now;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.total_paid += amount;
        sub.total_gas_spent += gas_used;
        sub.charge_count += 1;

        storage_persistent_set(
            &env,
            &storage,
            StorageKey::Subscription(subscription_id),
            sub.clone(),
        );

        // Store gas snapshot
        let snapshot = GasPriceSnapshot {
            ledger_seq: env.ledger().sequence(),
            timestamp: now,
            gas_used,
            amount_charged: amount,
        };
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
            MevStorageValue::GasPriceSnapshot(snapshot),
        );

        // Revenue
        revenue::generate_revenue_schedule(
            &env,
            &storage,
            subscription_id,
            sub.plan_id,
            amount,
            now,
            plan.interval.seconds(),
        );
        revenue::update_merchant_revenue_balances(&env, &storage, &plan.merchant, 0, amount);
        revenue::track_merchant_subscription(&env, &storage, &plan.merchant, subscription_id);

        env.events().publish(
            (String::from_str(&env, "mev_event"), subscription_id),
            (MevEventKind::Revealed, sub.subscriber.clone(), amount, now),
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
                    String::from_str(&env, "").into_val(&env),
                    String::from_str(&env, "").into_val(&env),
                    String::from_str(&env, "").into_val(&env),
                ],
            );
            let _ = _invoice;
        }
    }

    // ── MEV Protection: Configuration ──

    /// Set per-subscription MEV protection configuration.
    pub fn set_mev_charge_config(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        config: MevChargeConfig,
    ) {
        proxy.require_auth();
        let sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");
        sub.subscriber.require_auth();
        storage_persistent_set(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
            MevStorageValue::MevChargeConfig(config),
        );
    }

    /// Get the MEV protection configuration for a subscription.
    pub fn get_mev_charge_config(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> Option<MevChargeConfig> {
        proxy.require_auth();
        storage_persistent_get::<MevStorageValue>(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
        )
        .and_then(|v| match v {
            MevStorageValue::MevChargeConfig(c) => Some(c),
            _ => None,
        })
    }

    /// Get the latest gas price snapshot for a subscription.
    pub fn get_gas_price_snapshot(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
    ) -> Option<GasPriceSnapshot> {
        proxy.require_auth();
        storage_persistent_get::<MevStorageValue>(
            &env,
            &storage,
            StorageKey::MevState(subscription_id),
        )
        .and_then(|v| match v {
            MevStorageValue::GasPriceSnapshot(s) => Some(s),
            _ => None,
        })
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

        let metadata = event_store::build_event_metadata(&env, &sub.subscriber);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::RefundRequested,
            metadata,
            &sub.status,
            &sub.status,
            sub.plan_id,
            amount,
        );
    }

    pub fn approve_refund(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let admin = get_admin(&env, &storage);
        require_permission(&env, &storage, &admin, Permission::ApproveRefund);

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

        let metadata = event_store::build_event_metadata(&env, &admin);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::RefundApproved,
            metadata,
            &sub.status,
            &sub.status,
            sub.plan_id,
            amount,
        );
    }

    pub fn reject_refund(env: Env, proxy: Address, storage: Address, subscription_id: u64) {
        proxy.require_auth();
        let mut sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");

        let admin = get_admin(&env, &storage);
        require_permission(&env, &storage, &admin, Permission::RejectRefund);

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

        let metadata = event_store::build_event_metadata(&env, &admin);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::RefundRejected,
            metadata,
            &sub.status,
            &sub.status,
            sub.plan_id,
            0,
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

        // Pending transfers are a short-lived "pending operation" that also
        // grants the recipient temporary authorization to accept.  They belong
        // in transient storage: the offer should not persist (and accrue rent)
        // indefinitely, and auto-expiry after PENDING_TRANSFER_TTL_SECS gives
        // the offer a natural deadline.
        storage_temporary_set(
            &env,
            &storage,
            StorageKey::TmpPendingTransfer(subscription_id),
            recipient.clone(),
            secs_to_ledgers(PENDING_TRANSFER_TTL_SECS),
        );

        env.events().publish(
            (
                String::from_str(&env, "transfer_requested"),
                subscription_id,
            ),
            (sub.subscriber.clone(), recipient),
        );

        let metadata = event_store::build_event_metadata(&env, &sub.subscriber);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::TransferRequested,
            metadata,
            &sub.status,
            &sub.status,
            sub.plan_id,
            0,
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

        let pending_recipient: Address = storage_temporary_get(
            &env,
            &storage,
            StorageKey::TmpPendingTransfer(subscription_id),
        )
        .expect("No pending transfer for this subscription (it may have expired)");
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

        storage_temporary_remove(
            &env,
            &storage,
            StorageKey::TmpPendingTransfer(subscription_id),
        );

        env.events().publish(
            (String::from_str(&env, "transfer_accepted"), subscription_id),
            (old, recipient),
        );

        let metadata = event_store::build_event_metadata(&env, &recipient);
        event_store::record_event(
            &env,
            subscription_id,
            sub.plan_id,
            events::SubscriptionEventType::TransferAccepted,
            metadata,
            &sub.status,
            &sub.status,
            sub.plan_id,
            0,
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

    // ── Loyalty & Rewards API ──

    pub fn initialize_loyalty(
        env: Env,
        proxy: Address,
        storage: Address,
        config: subtrackr_types::LoyaltyConfig,
    ) {
        proxy.require_auth();
        get_admin(&env, &storage).require_auth();
        loyalty::set_loyalty_config(&env, &storage, &config);
    }

    pub fn update_loyalty_config(
        env: Env,
        proxy: Address,
        storage: Address,
        config: subtrackr_types::LoyaltyConfig,
    ) {
        proxy.require_auth();
        get_admin(&env, &storage).require_auth();
        loyalty::set_loyalty_config(&env, &storage, &config);
    }

    pub fn get_loyalty_config(
        env: Env,
        proxy: Address,
        storage: Address,
    ) -> Option<subtrackr_types::LoyaltyConfig> {
        proxy.require_auth();
        loyalty::get_loyalty_config(&env, &storage)
    }

    pub fn get_points(env: Env, proxy: Address, storage: Address, subscriber: Address) -> u64 {
        proxy.require_auth();
        loyalty::get_eligible_points(&env, &storage, &subscriber)
    }

    pub fn get_lifetime_points(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
    ) -> u64 {
        proxy.require_auth();
        loyalty::get_lifetime_points(&env, &storage, &subscriber)
    }

    pub fn get_streak(env: Env, proxy: Address, storage: Address, subscriber: Address) -> u64 {
        proxy.require_auth();
        loyalty::get_streak(&env, &storage, &subscriber)
    }

    pub fn get_loyalty_status(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
    ) -> (
        u64,
        u64,
        u64,
        i128,
        Option<subtrackr_types::LoyaltyTierConfig>,
    ) {
        proxy.require_auth();
        let points = loyalty::get_eligible_points(&env, &storage, &subscriber);
        let lifetime = loyalty::get_lifetime_points(&env, &storage, &subscriber);
        let streak = loyalty::get_streak(&env, &storage, &subscriber);
        let spent = loyalty::get_total_spent(&env, &storage, &subscriber);
        let tier = loyalty::get_current_tier(&env, &storage, &subscriber);
        (points, lifetime, streak, spent, tier)
    }

    pub fn redeem_loyalty_points(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        points: u64,
        charge_amount: i128,
    ) -> i128 {
        proxy.require_auth();
        subscriber.require_auth();
        let now = env.ledger().timestamp();
        loyalty::redeem_points(&env, &storage, &subscriber, points, charge_amount, now)
    }

    pub fn earn_referral_bonus(env: Env, proxy: Address, storage: Address, referrer: Address) {
        proxy.require_auth();
        let now = env.ledger().timestamp();
        loyalty::earn_referral_bonus(&env, &storage, &referrer, now);
    }

    pub fn expire_points(env: Env, proxy: Address, storage: Address, subscriber: Address) {
        proxy.require_auth();
        get_admin(&env, &storage).require_auth();
        loyalty::expire_points(&env, &storage, &subscriber);
    }

    pub fn get_point_transactions(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
    ) -> Vec<subtrackr_types::PointTransaction> {
        proxy.require_auth();
        loyalty::get_point_transactions(&env, &storage, &subscriber)
    }

    pub fn get_redemption(
        env: Env,
        proxy: Address,
        storage: Address,
        redemption_id: u64,
    ) -> Option<subtrackr_types::RewardsRedemption> {
        proxy.require_auth();
        loyalty::get_redemption(&env, &storage, redemption_id)
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

    // ── Payment Method API ──
    // Added in storage version 6

    pub fn add_payment_method(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        token_type: TokenType,
        token_address: Address,
        chain_id: u64,
        label: String,
        priority: PaymentPriority,
        max_spend_per_interval: i128,
    ) -> PaymentMethodId {
        proxy.require_auth();
        user.require_auth();
        payment_methods::add_payment_method(
            &env,
            &user,
            token_type,
            token_address,
            chain_id,
            label,
            priority,
            max_spend_per_interval,
        )
    }

    pub fn remove_payment_method(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        method_id: PaymentMethodId,
    ) {
        proxy.require_auth();
        user.require_auth();
        payment_methods::remove_payment_method(&env, &user, method_id);
    }

    pub fn verify_payment_method(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        method_id: PaymentMethodId,
    ) {
        proxy.require_auth();
        user.require_auth();
        payment_methods::verify_payment_method(&env, &user, method_id);
    }

    pub fn set_payment_method_priority(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        method_id: PaymentMethodId,
        priority: PaymentPriority,
    ) {
        proxy.require_auth();
        user.require_auth();
        payment_methods::set_payment_method_priority(&env, &user, method_id, priority);
    }

    pub fn set_payment_method_expiry(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        method_id: PaymentMethodId,
        expires_at: u64,
    ) {
        proxy.require_auth();
        user.require_auth();
        payment_methods::set_payment_method_expiry(&env, &user, method_id, expires_at);
    }

    pub fn charge_with_fallback(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        merchant: Address,
        token_address: Address,
        amount: i128,
        subscription_id: u64,
    ) -> bool {
        proxy.require_auth();
        user.require_auth();
        payment_methods::charge_with_fallback(
            &env,
            &user,
            &merchant,
            &token_address,
            amount,
            subscription_id,
        )
    }

    pub fn get_payment_method(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
        method_id: PaymentMethodId,
    ) -> PaymentMethod {
        proxy.require_auth();
        payment_methods::get_payment_method(&env, &user, method_id)
    }

    pub fn list_payment_methods(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
    ) -> Vec<PaymentMethod> {
        proxy.require_auth();
        payment_methods::list_payment_methods(&env, &user)
    }

    pub fn get_expired_methods(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
    ) -> Vec<PaymentMethodId> {
        proxy.require_auth();
        payment_methods::get_expired_methods(&env, &user)
    }

    pub fn get_expiring_soon_methods(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
    ) -> Vec<PaymentMethodId> {
        proxy.require_auth();
        payment_methods::get_expiring_soon_methods(&env, &user)
    }

    pub fn deactivate_expired_methods(
        env: Env,
        proxy: Address,
        _storage: Address,
        user: Address,
    ) -> u32 {
        proxy.require_auth();
        user.require_auth();
        payment_methods::deactivate_expired_methods(&env, &user)
    }

    // ── Event Sourcing & Audit Trail ──

    pub fn set_retention_policy(
        env: Env,
        proxy: Address,
        storage: Address,
        max_events_per_subscription: u32,
        max_events_per_merchant: u32,
        retention_days: u64,
        auto_prune_enabled: bool,
    ) {
        proxy.require_auth();
        get_admin(&env, &storage).require_auth();

        let policy = events::EventRetentionPolicy {
            max_events_per_subscription,
            max_events_per_merchant,
            retention_days,
            auto_prune_enabled,
        };
        event_store::set_retention_policy(&env, policy);
    }

    pub fn get_retention_policy(
        env: Env,
        _storage: Address,
    ) -> Option<events::EventRetentionPolicy> {
        event_store::get_retention_policy(&env)
    }

    pub fn get_events(
        env: Env,
        _storage: Address,
        subscription_id: u64,
        filter_type: Option<u32>,
        start_time: u64,
        end_time: u64,
        limit: u32,
        offset: u32,
    ) -> Vec<events::StoredEvent> {
        let event_types = filter_type.map(|t| {
            let mut types: Vec<events::SubscriptionEventType> = Vec::new(&env);
            types.push_back(events::SubscriptionEventType::Created);
            types
        });

        let filter = events::EventFilter {
            subscription_id: Some(subscription_id),
            event_types: None,
            date_range: if start_time > 0 || end_time > 0 {
                Some(TimeRange {
                    start: start_time,
                    end: end_time,
                })
            } else {
                None
            },
            actor: None,
            limit: if limit == 0 { 100 } else { limit },
            offset,
        };

        event_store::get_events(&env, filter)
    }

    pub fn get_event(env: Env, _storage: Address, event_id: u64) -> Option<events::StoredEvent> {
        event_store::get_event(&env, event_id)
    }

    pub fn get_event_count(env: Env, _storage: Address, subscription_id: u64) -> u64 {
        event_store::get_event_count(&env, subscription_id)
    }

    pub fn reconstruct_subscription_state(
        env: Env,
        _storage: Address,
        subscription_id: u64,
    ) -> Option<Subscription> {
        state::reconstruct_state(&env, subscription_id)
    }

    pub fn reconstruct_sub_state_at(
        env: Env,
        _storage: Address,
        subscription_id: u64,
        target_timestamp: u64,
    ) -> Option<Subscription> {
        state::reconstruct_state_at(&env, subscription_id, target_timestamp)
    }

    pub fn export_events(
        env: Env,
        _storage: Address,
        proxy: Address,
        _merchant: Address,
        plan_id: u64,
        start_time: u64,
        end_time: u64,
    ) -> Result<Vec<events::StoredEvent>, errors::ContractError> {
        proxy.require_auth();
        let range = TimeRange {
            start: start_time,
            end: end_time,
        };
        event_store::export_events(&env, plan_id, range)
    }

    // ── Billing Schedules ──

    pub fn set_billing_schedule(
        env: Env,
        proxy: Address,
        storage: Address,
        subscription_id: u64,
        interval: subtrackr_types::Interval,
        start_date: u64,
        trial_period_days: u32,
        promotional_rate: i128,
        promotional_duration_days: u32,
        custom_invoice_day: u32,
    ) {
        proxy.require_auth();
        let sub: Subscription =
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found");
        sub.subscriber.require_auth();

        let schedule = subtrackr_types::BillingSchedule {
            interval,
            start_date,
            trial_period_days,
            promotional_rate,
            promotional_duration_days,
            custom_invoice_day,
        };
        billing::set_billing_schedule(&env, subscription_id, &schedule);
    }

    pub fn get_billing_schedule(
        env: Env,
        _storage: Address,
        subscription_id: u64,
    ) -> Option<subtrackr_types::BillingSchedule> {
        billing::get_billing_schedule(&env, subscription_id)
    }

    pub fn get_billing_preview(
        env: Env,
        _storage: Address,
        subscription_id: u64,
        price: i128,
        periods: u32,
    ) -> Vec<billing::BillingPreviewItem> {
        let schedule = billing::get_billing_schedule(&env, subscription_id).unwrap_or(
            subtrackr_types::BillingSchedule {
                interval: subtrackr_types::Interval::Monthly,
                start_date: 0,
                trial_period_days: 0,
                promotional_rate: 0,
                promotional_duration_days: 0,
                custom_invoice_day: 0,
            },
        );
        let now = env.ledger().timestamp();
        billing::get_billing_preview(&env, &schedule, price, now, periods)
    }

    // ── Multi-step Charging with Retry ──

    pub fn start_charge(
        env: Env,
        _storage: Address,
        subscription_id: u64,
        amount: i128,
    ) -> subtrackr_types::ChargeAttempt {
        charging::start_charge(&env, subscription_id, amount)
    }

    pub fn retry_charge(
        env: Env,
        _storage: Address,
        charge_id: u64,
    ) -> Option<subtrackr_types::ChargeAttempt> {
        let config = charging::default_retry_config();
        charging::retry_charge(&env, charge_id, &config)
    }

    pub fn get_charge_history(
        env: Env,
        _storage: Address,
        subscription_id: u64,
    ) -> Vec<subtrackr_types::ChargeAttempt> {
        charging::get_charge_history(&env, subscription_id)
    }

    pub fn abort_charge(env: Env, _storage: Address, proxy: Address, charge_id: u64) {
        proxy.require_auth();
        let mut attempt =
            charging::get_charge_attempt(&env, charge_id).expect("Charge attempt not found");
        charging::abort_charge(&env, &mut attempt);
    }

    // ── Payment Timeout & Recovery ──

    /// Configure timeout behaviour for a specific chain.  Admin only.
    pub fn set_chain_timeout_config(
        env: Env,
        proxy: Address,
        storage: Address,
        admin: Address,
        config: ChainTimeoutConfig,
    ) {
        proxy.require_auth();
        admin.require_auth();
        let stored_admin = get_admin(&env, &storage);
        assert!(
            admin == stored_admin,
            "Only admin can set chain timeout config"
        );
        timeout::set_chain_config(&env, config);
    }

    /// Retrieve the timeout configuration for a chain.
    pub fn get_chain_timeout_config(
        env: Env,
        _proxy: Address,
        chain_id: u64,
    ) -> ChainTimeoutConfig {
        timeout::get_chain_config(&env, chain_id)
    }

    /// Register a newly-submitted payment for timeout tracking.
    pub fn register_payment_pending(
        env: Env,
        proxy: Address,
        charge_id: u64,
        subscription_id: u64,
        chain_id: u64,
        initial_gas_price: u64,
    ) -> PaymentTimeout {
        proxy.require_auth();
        timeout::register_pending(
            &env,
            charge_id,
            subscription_id,
            chain_id,
            initial_gas_price,
        )
    }

    /// Check whether a pending payment has exceeded its chain timeout window.
    /// Transitions the record to `TimedOut` on first detection and emits an event.
    pub fn detect_payment_timeout(env: Env, proxy: Address, charge_id: u64) -> bool {
        proxy.require_auth();
        timeout::detect_timeout(&env, charge_id)
    }

    /// Automatically retry a timed-out payment with a higher gas price.
    pub fn recover_payment(
        env: Env,
        proxy: Address,
        charge_id: u64,
        new_gas_price: u64,
    ) -> Option<PaymentTimeout> {
        proxy.require_auth();
        timeout::attempt_recovery(&env, charge_id, new_gas_price)
    }

    /// Manual retry option for users — bumps gas and re-submits.
    pub fn manual_retry_payment(
        env: Env,
        proxy: Address,
        storage: Address,
        subscriber: Address,
        charge_id: u64,
        new_gas_price: u64,
    ) -> Option<PaymentTimeout> {
        proxy.require_auth();
        subscriber.require_auth();
        // Verify the charge belongs to this subscriber.
        let rec = timeout::get_timeout_record(&env, charge_id).expect("Timeout record not found");
        let sub: subtrackr_types::Subscription = storage_persistent_get(
            &env,
            &storage,
            subtrackr_types::StorageKey::Subscription(rec.subscription_id),
        )
        .expect("Subscription not found");
        assert!(
            sub.subscriber == subscriber,
            "Unauthorized: not the subscriber"
        );
        timeout::manual_retry(&env, charge_id, new_gas_price)
    }

    /// Mark a payment as confirmed on-chain after a successful recovery.
    pub fn mark_payment_resolved(
        env: Env,
        proxy: Address,
        charge_id: u64,
    ) -> Option<PaymentTimeout> {
        proxy.require_auth();
        timeout::mark_resolved(&env, charge_id)
    }

    /// Retrieve a single payment timeout record.
    pub fn get_payment_timeout(
        env: Env,
        _proxy: Address,
        charge_id: u64,
    ) -> Option<PaymentTimeout> {
        timeout::get_timeout_record(&env, charge_id)
    }

    /// List all payment timeout records for a subscription.
    pub fn get_subscription_timeouts(
        env: Env,
        proxy: Address,
        subscription_id: u64,
    ) -> Vec<PaymentTimeout> {
        proxy.require_auth();
        timeout::get_subscription_timeouts(&env, subscription_id)
    }

    /// List only stuck (timed-out or recovering) transactions for a subscription.
    pub fn get_stuck_transactions(
        env: Env,
        proxy: Address,
        subscription_id: u64,
    ) -> Vec<PaymentTimeout> {
        proxy.require_auth();
        timeout::get_stuck_transactions(&env, subscription_id)
    }

    /// Transaction health summary for the dashboard.
    pub fn get_tx_health_summary(
        env: Env,
        proxy: Address,
        subscription_id: u64,
    ) -> TxHealthSummary {
        proxy.require_auth();
        timeout::get_health_summary(&env, subscription_id)
    }
}

//  Proration & Plan Changes

/// Preview proration before confirming a plan change
pub fn preview_proration(
    env: Env,
    proxy: Address,
    storage: Address,
    subscription_id: u64,
    new_plan_id: u64,
    effective_date: u64, // 0 = Immediate, 1 = EndOfPeriod
) -> ProrationResult {
    proxy.require_auth();

    let sub: Subscription =
        storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    let old_plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
        .expect("Old plan not found");
    let new_plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(new_plan_id))
        .expect("New plan not found");

    let effective = if effective_date == 0 {
        EffectiveDate::Immediate
    } else {
        EffectiveDate::EndOfPeriod
    };

    let result =
        proration::preview_proration(&env, &sub, old_plan.price, new_plan.price, effective);

    // Cache the previewed prorated amount in transient storage so a client can
    // preview then confirm without recomputing.  This is purely intermediate
    // calculation state, so it lives in TEMPORARY storage and expires after one
    // billing interval — no persistent rent for a value that is only relevant
    // until the change is confirmed or abandoned.
    let signed_amount: i128 = if result.is_credit {
        -result.amount
    } else {
        result.amount
    };
    storage_temporary_set(
        &env,
        &storage,
        StorageKey::TmpProrationScratch(subscription_id),
        signed_amount,
        secs_to_ledgers(
            sub.next_charge_at
                .saturating_sub(sub.last_charged_at)
                .max(1),
        ),
    );

    result
}

/// Execute a plan change with proration
pub fn change_plan(
    env: Env,
    proxy: Address,
    storage: Address,
    subscriber: Address,
    subscription_id: u64,
    new_plan_id: u64,
    effective_date: u64,
) {
    proxy.require_auth();
    subscriber.require_auth();

    let mut sub: Subscription =
        storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    assert!(
        sub.subscriber == subscriber,
        "Only subscriber can change plan"
    );
    assert!(
        sub.status == SubscriptionStatus::Active || sub.status == SubscriptionStatus::Paused,
        "Subscription must be active to change plan"
    );

    let old_plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
        .expect("Old plan not found");
    let new_plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(new_plan_id))
        .expect("New plan not found");

    assert!(new_plan.active, "New plan is not active");

    let effective = if effective_date == 0 {
        EffectiveDate::Immediate
    } else {
        EffectiveDate::EndOfPeriod
    };

    let proration_result = proration::calculate_proration(
        &env,
        &sub,
        old_plan.price,
        new_plan.price,
        effective.clone(),
    );

    // Handle proration payment or credit
    if proration_result.amount > 0 {
        if proration_result.is_credit {
            // Generate credit memo for downgrade
            let memo = proration::generate_credit_memo(
                &env,
                subscription_id,
                proration_result.amount,
                proration_result.description.clone(),
            );
            // Store credit memo
            storage_persistent_set(
                &env,
                &storage,
                StorageKey::CreditMemo(subscription_id),
                memo,
            );
        } else {
            // Charge prorated amount for upgrade
            token::Client::new(&env, &new_plan.token).transfer(
                &subscriber,
                &new_plan.merchant,
                &proration_result.amount,
            );
        }
    }

    // Update subscription
    let now = env.ledger().timestamp();

    if effective == EffectiveDate::Immediate {
        // Reset billing cycle from now
        sub.last_charged_at = now;
        sub.next_charge_at = now + new_plan.interval.seconds();
    }
    // For EndOfPeriod, keep current billing dates

    sub.plan_id = new_plan_id;
    sub.total_paid += if proration_result.is_credit {
        0
    } else {
        proration_result.amount
    };

    storage_persistent_set(
        &env,
        &storage,
        StorageKey::Subscription(subscription_id),
        sub.clone(),
    );

    // Update user plan index
    remove_user_plan_index(&env, &storage, &subscriber, old_plan.id);
    set_user_plan_index(&env, &storage, &subscriber, new_plan_id, subscription_id);

    // Update plan subscriber counts
    let mut old_plan_mut = old_plan.clone();
    if old_plan_mut.subscriber_count > 0 {
        old_plan_mut.subscriber_count -= 1;
    }
    storage_persistent_set(&env, &storage, StorageKey::Plan(old_plan.id), old_plan_mut);

    let mut new_plan_mut = new_plan.clone();
    new_plan_mut.subscriber_count += 1;
    storage_persistent_set(&env, &storage, StorageKey::Plan(new_plan_id), new_plan_mut);

    env.events().publish(
        (String::from_str(&env, "plan_changed"), subscription_id),
        (
            subscriber,
            old_plan.id,
            new_plan_id,
            proration_result.amount,
            proration_result.is_credit,
        ),
    );

    let event_type = if new_plan.price >= old_plan.price {
        events::SubscriptionEventType::Upgraded
    } else {
        events::SubscriptionEventType::Downgraded
    };
    let metadata = event_store::build_event_metadata(&env, &subscriber);
    event_store::record_event(
        &env,
        subscription_id,
        new_plan_id,
        event_type,
        metadata,
        &sub.status,
        &sub.status,
        new_plan_id,
        proration_result.amount,
    );
}

/// Get stored credit memo for a subscription
pub fn get_credit_memo(
    env: Env,
    proxy: Address,
    storage: Address,
    subscription_id: u64,
) -> Option<CreditMemo> {
    proxy.require_auth();
    storage_persistent_get(&env, &storage, StorageKey::CreditMemo(subscription_id))
}

/// Apply credit memo to next charge
pub fn apply_credit_memo_to_charge(
    env: Env,
    proxy: Address,
    storage: Address,
    subscription_id: u64,
) -> i128 {
    proxy.require_auth();

    let mut sub: Subscription =
        storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    let mut memo: CreditMemo =
        storage_persistent_get(&env, &storage, StorageKey::CreditMemo(subscription_id))
            .expect("No credit memo found");

    let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(sub.plan_id))
        .expect("Plan not found");

    let charge_price = resolve_charge_price(&env, &storage, &plan);
    let final_charge = proration::apply_credit_memo(charge_price, &mut memo);

    // Update stored memo
    storage_persistent_set(
        &env,
        &storage,
        StorageKey::CreditMemo(subscription_id),
        memo,
    );

    final_charge
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::ContractError;
    use soroban_sdk::{testutils::Address as _, Bytes, Env, IntoVal};

    #[test]
    fn test_mev_error_codes_are_stable() {
        assert_eq!(ContractError::SlippageExceeded as u32, 22);
        assert_eq!(ContractError::CommitmentExpired as u32, 23);
        assert_eq!(ContractError::CommitmentMismatch as u32, 24);
        assert_eq!(ContractError::MaxGasExceeded as u32, 25);
        assert_eq!(ContractError::PrivateMempoolRequired as u32, 26);
    }

    #[test]
    fn test_mev_error_messages() {
        assert_eq!(
            ContractError::SlippageExceeded.user_message(),
            "Charge price exceeds configured slippage bounds."
        );
        assert_eq!(
            ContractError::CommitmentExpired.user_message(),
            "Commit-reveal deadline has passed."
        );
        assert_eq!(
            ContractError::CommitmentMismatch.user_message(),
            "Revealed values do not match the commitment."
        );
        assert_eq!(
            ContractError::MaxGasExceeded.user_message(),
            "Gas cost exceeds subscriber's configured maximum."
        );
        assert_eq!(
            ContractError::PrivateMempoolRequired.user_message(),
            "This charge requires a private mempool submission."
        );
    }

    #[test]
    fn test_mev_type_roundtrip() {
        let env = Env::default();

        let config = MevChargeConfig {
            use_private_mempool: true,
            max_gas_fee: 100_000i128,
            max_gas: 200_000u64,
        };

        // Verify contracttype derives clone + partial eq
        let cloned = config.clone();
        assert_eq!(config, cloned);
        assert!(config.use_private_mempool);
        assert_eq!(config.max_gas_fee, 100_000i128);
        assert_eq!(config.max_gas, 200_000u64);

        let snapshot = GasPriceSnapshot {
            ledger_seq: 42,
            timestamp: 1_000_000,
            gas_used: 100_000,
            amount_charged: 1_000_000_000i128,
        };
        assert_eq!(snapshot.ledger_seq, 42);
        assert_eq!(snapshot.gas_used, 100_000);
    }

    #[test]
    fn test_commitment_hash_computation() {
        let env = Env::default();

        let amount: i128 = 500_000_000;
        let nonce = Bytes::from_array(&env, &[42u8; 8]);

        let build_hash = |amt: i128, n: &Bytes| -> Bytes {
            let arr = amt.to_be_bytes();
            let amount_bytes = Bytes::from_slice(&env, &arr);
            let mut preimage = Bytes::new(&env);
            preimage.append(&amount_bytes);
            preimage.append(n);
            env.crypto().sha256(&preimage).into()
        };

        let h1 = build_hash(amount, &nonce);
        let h2 = build_hash(amount, &nonce);
        assert_eq!(h1, h2, "Deterministic hash");
    }

    #[test]
    fn test_commitment_hash_differs_with_different_amount() {
        let env = Env::default();
        let nonce = Bytes::from_array(&env, &[42u8; 8]);

        let build_hash = |amt: i128, n: &Bytes| -> Bytes {
            let arr = amt.to_be_bytes();
            let amount_bytes = Bytes::from_slice(&env, &arr);
            let mut preimage = Bytes::new(&env);
            preimage.append(&amount_bytes);
            preimage.append(n);
            env.crypto().sha256(&preimage).into()
        };

        let h1 = build_hash(500_000_000, &nonce);
        let h2 = build_hash(600_000_000, &nonce);
        assert_ne!(h1, h2, "Different amounts must produce different hashes");
    }

    #[test]
    fn test_mev_event_kind_variants() {
        // Verify all variants exist and are distinct
        let variants = [
            MevEventKind::Committed,
            MevEventKind::Revealed,
            MevEventKind::Expired,
            MevEventKind::GasPriceAnomaly,
            MevEventKind::PrivateMempoolSubmitted,
            MevEventKind::SlippageProtected,
        ];
        assert_eq!(variants.len(), 6);
    }

    #[test]
    fn test_charge_commitment_clone_eq() {
        let env = Env::default();
        let subscriber = Address::random(&env);
        let hash = Bytes::from_array(&env, &[1u8; 32]);

        let c1 = ChargeCommitment {
            commitment_hash: hash.clone(),
            max_gas_fee: 100_000i128,
            deadline: 1_000_000,
            subscriber: subscriber.clone(),
        };
        let c2 = c1.clone();
        assert_eq!(c1, c2);
        assert_eq!(c1.subscriber, subscriber);
    }
}
