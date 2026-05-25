use proptest::prelude::*;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    token, Address, Env, IntoVal, String, Symbol,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, StorageKey, SubscriptionStatus};

#[contract]
pub struct ChargingBot;

#[contractimpl]
impl ChargingBot {
    pub fn charge(env: Env, proxy_contract: Address, subscription_id: u64) {
        let proxy = UpgradeableProxyClient::new(&env, &proxy_contract);
        proxy.charge_subscription(&subscription_id);
    }
}

#[contracttype]
#[derive(Clone)]
enum ReentrantTokenKey {
    Proxy,
    SubscriptionId,
    Entered,
    Balance(Address),
}

#[contract]
pub struct ReentrantToken;

fn reentrant_token_balance(env: &Env, owner: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&ReentrantTokenKey::Balance(owner.clone()))
        .unwrap_or(0)
}

fn set_reentrant_token_balance(env: &Env, owner: &Address, amount: i128) {
    env.storage()
        .instance()
        .set(&ReentrantTokenKey::Balance(owner.clone()), &amount);
}

#[contractimpl]
impl ReentrantToken {
    pub fn init(env: Env, proxy: Address, subscription_id: u64) {
        env.storage()
            .instance()
            .set(&ReentrantTokenKey::Proxy, &proxy);
        env.storage()
            .instance()
            .set(&ReentrantTokenKey::SubscriptionId, &subscription_id);
        env.storage()
            .instance()
            .set(&ReentrantTokenKey::Entered, &false);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        assert!(amount >= 0, "Amount must be non-negative");
        let balance = reentrant_token_balance(&env, &to);
        set_reentrant_token_balance(&env, &to, balance + amount);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        reentrant_token_balance(&env, &id)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        assert!(amount >= 0, "Amount must be non-negative");
        from.require_auth();

        let entered: bool = env
            .storage()
            .instance()
            .get(&ReentrantTokenKey::Entered)
            .unwrap_or(false);
        if !entered {
            env.storage()
                .instance()
                .set(&ReentrantTokenKey::Entered, &true);

            let proxy: Address = env
                .storage()
                .instance()
                .get(&ReentrantTokenKey::Proxy)
                .expect("Proxy not configured");
            let subscription_id: u64 = env
                .storage()
                .instance()
                .get(&ReentrantTokenKey::SubscriptionId)
                .expect("Subscription not configured");
            let proxy_client = UpgradeableProxyClient::new(&env, &proxy);
            proxy_client.charge_subscription(&subscription_id);

            env.storage()
                .instance()
                .set(&ReentrantTokenKey::Entered, &false);
        }

        let from_balance = reentrant_token_balance(&env, &from);
        assert!(from_balance >= amount, "Insufficient balance");
        let to_balance = reentrant_token_balance(&env, &to);
        set_reentrant_token_balance(&env, &from, from_balance - amount);
        set_reentrant_token_balance(&env, &to, to_balance + amount);
    }
}

struct IntegrationSetup {
    env: Env,
    proxy_id: Address,
    storage_id: Address,
    merchant: Address,
    subscriber: Address,
    token_id: Address,
    plan_id: u64,
    subscription_id: u64,
}

impl IntegrationSetup {
    fn proxy(&self) -> UpgradeableProxyClient<'_> {
        UpgradeableProxyClient::new(&self.env, &self.proxy_id)
    }

    fn token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.token_id)
    }
}

fn setup_integration() -> IntegrationSetup {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(1_700_000_000);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let storage_id = env.register_contract(None, SubTrackrStorage);
    let implementation_id = env.register_contract(None, SubTrackrSubscription);

    let proxy_id = env.register_contract(None, UpgradeableProxy);
    let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
    proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    token_admin_client.mint(&subscriber, &50_000);

    let plan_id = proxy.create_plan(
        &merchant,
        &String::from_str(&env, "Integration Plan"),
        &500,
        &token_id.address(),
        &Interval::Monthly,
    );
    let subscription_id = proxy.subscribe(&subscriber, &plan_id);

    IntegrationSetup {
        env,
        proxy_id,
        storage_id,
        merchant,
        subscriber,
        token_id: token_id.address(),
        plan_id,
        subscription_id,
    }
}

#[test]
fn integration_contract_deploys_and_state_persists() {
    let setup = setup_integration();
    let proxy = setup.proxy();

    assert_eq!(proxy.get_plan_count(), 1);
    assert_eq!(proxy.get_subscription_count(), 1);

    let plan = proxy.get_plan(&setup.plan_id);
    assert!(plan.active);
    assert_eq!(plan.merchant, setup.merchant);
    assert_eq!(plan.price, 500);

    let sub = proxy.get_subscription(&setup.subscription_id);
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(sub.plan_id, setup.plan_id);

    let user_subs = proxy.get_user_subscriptions(&setup.subscriber);
    assert_eq!(user_subs.len(), 1);
    assert_eq!(user_subs.get_unchecked(0), setup.subscription_id);
}

#[test]
fn integration_uses_actual_token_contract_for_charges() {
    let setup = setup_integration();

    let proxy = setup.proxy();
    let token = setup.token();

    let subscriber_before = token.balance(&setup.subscriber);
    let merchant_before = token.balance(&setup.merchant);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 10);

    proxy.charge_subscription(&setup.subscription_id);

    let subscriber_after = token.balance(&setup.subscriber);
    let merchant_after = token.balance(&setup.merchant);

    assert_eq!(subscriber_before - subscriber_after, 500);
    assert_eq!(merchant_after - merchant_before, 500);

    let sub = proxy.get_subscription(&setup.subscription_id);
    assert_eq!(sub.total_paid, 500);
    assert_eq!(sub.charge_count, 1);
}

#[test]
fn integration_cross_contract_call_charges_subscription() {
    let setup = setup_integration();

    let proxy = setup.proxy();

    let bot_id = setup.env.register_contract(None, ChargingBot);
    let bot = ChargingBotClient::new(&setup.env, &bot_id);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 20);

    bot.charge(&setup.proxy_id, &setup.subscription_id);

    let sub = proxy.get_subscription(&setup.subscription_id);
    assert_eq!(sub.charge_count, 1);
    assert_eq!(sub.total_paid, 500);
}

#[test]
fn integration_multiple_contract_interactions_work() {
    let setup = setup_integration();

    let second_merchant = Address::generate(&setup.env);
    let second_token_admin = Address::generate(&setup.env);

    let second_token_id = setup
        .env
        .register_stellar_asset_contract_v2(second_token_admin.clone());
    let second_token_admin_client =
        token::StellarAssetClient::new(&setup.env, &second_token_id.address());
    let second_token = token::Client::new(&setup.env, &second_token_id.address());

    second_token_admin_client.mint(&setup.subscriber, &70_000);

    let proxy = setup.proxy();
    let token = setup.token();

    let second_plan_id = proxy.create_plan(
        &second_merchant,
        &String::from_str(&setup.env, "Premium Plan"),
        &900,
        &second_token_id.address(),
        &Interval::Monthly,
    );
    let second_subscription_id = proxy.subscribe(&setup.subscriber, &second_plan_id);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 30);

    proxy.charge_subscription(&setup.subscription_id);
    proxy.charge_subscription(&second_subscription_id);

    let sub1 = proxy.get_subscription(&setup.subscription_id);
    let sub2 = proxy.get_subscription(&second_subscription_id);

    assert_eq!(sub1.total_paid, 500);
    assert_eq!(sub2.total_paid, 900);

    assert_eq!(token.balance(&setup.merchant), 500);
    assert_eq!(second_token.balance(&second_merchant), 900);
}

#[test]
#[should_panic]
fn integration_blocks_reentrant_token_transfer_callback() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(1_700_000_000);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);

    let storage_id = env.register_contract(None, SubTrackrStorage);
    let implementation_id = env.register_contract(None, SubTrackrSubscription);
    let proxy_id = env.register_contract(None, UpgradeableProxy);
    let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
    proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

    let token_id = env.register_contract(None, ReentrantToken);
    let token = ReentrantTokenClient::new(&env, &token_id);
    token.mint(&subscriber, &50_000);

    let plan_id = proxy.create_plan(
        &merchant,
        &String::from_str(&env, "Reentrant Plan"),
        &500,
        &token_id,
        &Interval::Monthly,
    );
    let subscription_id = proxy.subscribe(&subscriber, &plan_id);
    token.init(&proxy_id, &subscription_id);

    env.ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 40);

    proxy.charge_subscription(&subscription_id);
}

#[test]
fn integration_existing_charge_lock_rejects_entry_before_transfer() {
    let setup = setup_integration();
    let proxy = setup.proxy();
    let token = setup.token();

    force_charge_lock(&setup.env, &setup.storage_id);
    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 50);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        proxy.charge_subscription(&setup.subscription_id);
    }));

    assert!(result.is_err());
    assert_eq!(token.balance(&setup.subscriber), 50_000);
    assert_eq!(token.balance(&setup.merchant), 0);
    let sub = proxy.get_subscription(&setup.subscription_id);
    assert_eq!(sub.charge_count, 0);
    assert_eq!(sub.total_paid, 0);
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 8,
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    #[test]
    fn prop_reentrant_token_charge_reverts_before_double_transfer(
        price in 1i128..5_000i128,
        due_offset in 1u64..10_000u64,
    ) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_timestamp(1_700_000_000);

        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);

        let storage_id = env.register_contract(None, SubTrackrStorage);
        let implementation_id = env.register_contract(None, SubTrackrSubscription);
        let proxy_id = env.register_contract(None, UpgradeableProxy);
        let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
        proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

        let token_id = env.register_contract(None, ReentrantToken);
        let token = ReentrantTokenClient::new(&env, &token_id);
        token.mint(&subscriber, &(price * 10));

        let plan_id = proxy.create_plan(
            &merchant,
            &String::from_str(&env, "Reentrant Property Plan"),
            &price,
            &token_id,
            &Interval::Monthly,
        );
        let subscription_id = proxy.subscribe(&subscriber, &plan_id);
        token.init(&proxy_id, &subscription_id);

        env.ledger()
            .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + due_offset);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            proxy.charge_subscription(&subscription_id);
        }));
        prop_assert!(result.is_err());
    }
}

fn force_charge_lock(env: &Env, storage_id: &Address) {
    env.invoke_contract::<()>(
        storage_id,
        &Symbol::new(env, "instance_set"),
        soroban_sdk::vec![
            env,
            StorageKey::ReentrancyLock(String::from_str(env, "charge_subscription")).into_val(env),
            true.into_val(env)
        ],
    );
}
