#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token, Address, Env, IntoVal, String, TryFromVal, Val, Vec,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, Plan, StorageKey, Subscription, SubscriptionStatus};

// ─────────────────────────────────────────────────────────────────────────────
// V1 implementation used to seed state before upgrading to v2.
// ─────────────────────────────────────────────────────────────────────────────

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

fn get_admin(env: &Env, storage: &Address) -> Address {
    storage_instance_get(env, storage, StorageKey::Admin).expect("Admin not set")
}

mod v1_impl {
    use super::*;

    #[contract]
    pub struct SubTrackrSubscriptionV1;

    #[contractimpl]
    impl SubTrackrSubscriptionV1 {
        pub fn get_version(_env: Env, proxy: Address, _storage: Address) -> u32 {
            proxy.require_auth();
            1
        }

        pub fn validate_upgrade(env: Env, proxy: Address, storage: Address, from_version: u32) {
            proxy.require_auth();
            assert!(from_version == 1, "Unsupported version");
            let _admin = get_admin(&env, &storage);
        }

        pub fn migrate(_env: Env, proxy: Address, _storage: Address, from_version: u32) {
            proxy.require_auth();
            assert!(from_version == 1, "Unsupported migration");
        }

        pub fn initialize(env: Env, proxy: Address, storage: Address, admin: Address) {
            proxy.require_auth();
            admin.require_auth();

            storage_instance_set(&env, &storage, StorageKey::Admin, admin);
            storage_instance_set(&env, &storage, StorageKey::PlanCount, 0u64);
            storage_instance_set(&env, &storage, StorageKey::SubscriptionCount, 0u64);
        }

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
            merchant.require_auth();

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
            storage_persistent_set(&env, &storage, StorageKey::Plan(count), plan);
            storage_instance_set(&env, &storage, StorageKey::PlanCount, count);
            count
        }

        pub fn subscribe(
            env: Env,
            proxy: Address,
            storage: Address,
            subscriber: Address,
            plan_id: u64,
        ) -> u64 {
            proxy.require_auth();
            subscriber.require_auth();

            let plan: Plan = storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
                .expect("Plan not found");
            assert!(plan.active, "Plan is not active");

            let mut sub_count: u64 =
                storage_instance_get(&env, &storage, StorageKey::SubscriptionCount).unwrap_or(0);
            sub_count += 1;

            let now = env.ledger().timestamp();
            let sub = Subscription {
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

            storage_persistent_set(&env, &storage, StorageKey::Subscription(sub_count), sub);
            storage_instance_set(&env, &storage, StorageKey::SubscriptionCount, sub_count);

            sub_count
        }

        pub fn get_plan(env: Env, proxy: Address, storage: Address, plan_id: u64) -> Plan {
            proxy.require_auth();
            storage_persistent_get(&env, &storage, StorageKey::Plan(plan_id))
                .expect("Plan not found")
        }

        pub fn get_subscription(
            env: Env,
            proxy: Address,
            storage: Address,
            subscription_id: u64,
        ) -> Subscription {
            proxy.require_auth();
            storage_persistent_get(&env, &storage, StorageKey::Subscription(subscription_id))
                .expect("Subscription not found")
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Bad implementation for validation tests.
// ─────────────────────────────────────────────────────────────────────────────

mod bad_impl {
    use super::*;

    #[contract]
    pub struct BadImplementation;

    #[contractimpl]
    impl BadImplementation {
        pub fn get_version(_env: Env, proxy: Address, _storage: Address) -> u32 {
            proxy.require_auth();
            99
        }

        pub fn validate_upgrade(_env: Env, _proxy: Address, _storage: Address, _from_version: u32) {
            panic!("incompatible state");
        }

        pub fn migrate(_env: Env, _proxy: Address, _storage: Address, _from_version: u32) {
            // no-op
        }

        pub fn initialize(env: Env, proxy: Address, storage: Address, admin: Address) {
            proxy.require_auth();
            admin.require_auth();
            storage_instance_set(&env, &storage, StorageKey::Admin, admin);
            storage_instance_set(&env, &storage, StorageKey::PlanCount, 0u64);
            storage_instance_set(&env, &storage, StorageKey::SubscriptionCount, 0u64);
        }
    }
}

fn setup_proxy_with_v1<'a>(
    env: &'a Env,
    admin: &'a Address,
) -> (UpgradeableProxyClient<'a>, Address, Address) {
    let storage_id = env.register_contract(None, SubTrackrStorage);
    let impl_v1_id = env.register_contract(None, v1_impl::SubTrackrSubscriptionV1);
    let impl_v2_id = env.register_contract(None, SubTrackrSubscription);

    let proxy_id = env.register_contract(None, UpgradeableProxy);
    let proxy = UpgradeableProxyClient::new(env, &proxy_id);

    proxy.initialize(admin, &storage_id, &impl_v1_id, &100u64, &50u64);

    (proxy, impl_v1_id, impl_v2_id)
}

#[test]
fn upgrade_flow_preserves_state_and_enforces_timelocks() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(1_700_000_000);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (proxy, impl_v1_id, impl_v2_id) = setup_proxy_with_v1(&env, &admin);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    token_admin_client.mint(&subscriber, &50_000);

    let plan_id = proxy.create_plan(
        &merchant,
        &String::from_str(&env, "Plan"),
        &500,
        &token_id.address(),
        &Interval::Monthly,
    );
    let sub_id = proxy.subscribe(&subscriber, &plan_id);

    assert_eq!(proxy.get_plan_count(), 1);
    assert_eq!(proxy.get_subscription_count(), 1);
    assert_eq!(proxy.get_version(), 1);

    proxy.authorize_upgrade(&admin, &impl_v2_id);
    let scheduled = proxy.get_scheduled_upgrade().unwrap();
    assert_eq!(scheduled.implementation, impl_v2_id);
    assert_eq!(scheduled.execute_after, 1_700_000_000 + 100);

    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        proxy.upgrade_to(&impl_v2_id)
    }));
    assert!(early.is_err());

    env.ledger().set_timestamp(scheduled.execute_after);
    proxy.upgrade_to(&impl_v2_id);

    assert_eq!(proxy.get_implementation(), impl_v2_id);
    assert_eq!(proxy.get_version(), 2);

    let plan = proxy.get_plan(&plan_id);
    assert_eq!(plan.price, 500);
    let sub = proxy.get_subscription(&sub_id);
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(sub.plan_id, plan_id);

    // Schedule rollback and enforce timelock
    let rollback_after = proxy.rollback();
    let early_rb = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        proxy.upgrade_to(&impl_v1_id)
    }));
    assert!(early_rb.is_err());

    env.ledger().set_timestamp(rollback_after);
    proxy.upgrade_to(&impl_v1_id);

    assert_eq!(proxy.get_implementation(), impl_v1_id);
    // Storage version stays at the highest-applied schema.
    assert_eq!(proxy.get_version(), 2);

    // History: schedule upgrade, execute upgrade, schedule rollback, execute rollback
    assert_eq!(proxy.get_upgrade_history_count(), 4);
}

#[test]
fn upgrade_validation_failure_does_not_change_implementation() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(1_700_000_000);

    let admin = Address::generate(&env);

    let (proxy, _impl_v1_id, impl_v2_id) = setup_proxy_with_v1(&env, &admin);
    let bad_impl_id = env.register_contract(None, bad_impl::BadImplementation);

    // Upgrade to v2 first so we have previous history.
    proxy.authorize_upgrade(&admin, &impl_v2_id);
    let scheduled = proxy.get_scheduled_upgrade().unwrap();
    env.ledger().set_timestamp(scheduled.execute_after);
    proxy.upgrade_to(&impl_v2_id);
    assert_eq!(proxy.get_implementation(), impl_v2_id);

    // Schedule upgrade to bad implementation and ensure execute fails and state is unchanged.
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    proxy.schedule_upgrade(&bad_impl_id, &(env.ledger().timestamp() + 100));

    let scheduled_bad = proxy.get_scheduled_upgrade().unwrap();
    env.ledger().set_timestamp(scheduled_bad.execute_after);

    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        proxy.upgrade_to(&bad_impl_id)
    }));
    assert!(res.is_err());

    assert_eq!(proxy.get_implementation(), impl_v2_id);
    assert!(proxy.get_scheduled_upgrade().is_some());
}
