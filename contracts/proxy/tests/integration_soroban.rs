use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, String,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, MevProtectionConfig, SubscriptionStatus};

#[contract]
pub struct ChargingBot;

#[contractimpl]
impl ChargingBot {
    pub fn charge(env: Env, proxy_contract: Address, subscription_id: u64) {
        let proxy = UpgradeableProxyClient::new(&env, &proxy_contract);
        proxy.charge_subscription(&subscription_id);
    }
}

struct IntegrationSetup {
    env: Env,
    proxy_id: Address,
    admin: Address,
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
        admin,
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

fn mev_config(threshold: i128, gas_threshold: u64, private_required: bool) -> MevProtectionConfig {
    MevProtectionConfig {
        large_charge_threshold: threshold,
        max_fee_bps: 100,
        reveal_delay_secs: 30,
        commit_ttl_secs: 3_600,
        private_mempool_required: private_required,
        gas_price_alert_threshold: gas_threshold,
    }
}

#[test]
fn integration_large_charge_uses_commit_reveal_and_fee_bounds() {
    let setup = setup_integration();
    let proxy = setup.proxy();
    let token = setup.token();
    let salt = BytesN::from_array(&setup.env, &[7u8; 32]);
    let commitment = proxy.hash_charge_commitment(&setup.subscription_id, &505, &salt);

    proxy.configure_mev_protection(&setup.admin, &mev_config(400, 10, false));
    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds());
    proxy.commit_charge(&setup.subscription_id, &commitment);

    let pending = proxy
        .get_charge_commitment(&setup.subscription_id)
        .expect("commitment should be stored");
    assert_eq!(pending.subscription_id, setup.subscription_id);
    assert_eq!(pending.commitment, commitment);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 31);

    let subscriber_before = token.balance(&setup.subscriber);
    let merchant_before = token.balance(&setup.merchant);

    proxy.reveal_charge(&setup.subscription_id, &salt, &505, &25, &false);

    assert!(proxy
        .get_charge_commitment(&setup.subscription_id)
        .is_none());
    assert_eq!(token.balance(&setup.subscriber), subscriber_before - 500);
    assert_eq!(token.balance(&setup.merchant), merchant_before + 500);
    assert_eq!(proxy.get_mev_alert_count(), 1);

    let sub = proxy.get_subscription(&setup.subscription_id);
    assert_eq!(sub.total_paid, 500);
    assert_eq!(sub.charge_count, 1);
}

#[test]
fn integration_large_direct_charge_requires_commitment() {
    let setup = setup_integration();
    let proxy = setup.proxy();

    proxy.configure_mev_protection(&setup.admin, &mev_config(400, u64::MAX, false));
    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 10);

    let result = proxy.try_charge_subscription(&setup.subscription_id);
    assert!(result.is_err());
}

#[test]
fn integration_private_mempool_requirement_blocks_public_reveal() {
    let setup = setup_integration();
    let proxy = setup.proxy();
    let salt = BytesN::from_array(&setup.env, &[9u8; 32]);
    let commitment = proxy.hash_charge_commitment(&setup.subscription_id, &505, &salt);

    proxy.configure_mev_protection(&setup.admin, &mev_config(400, u64::MAX, true));
    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds());
    proxy.commit_charge(&setup.subscription_id, &commitment);
    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 31);

    let result = proxy.try_reveal_charge(&setup.subscription_id, &salt, &505, &1, &false);
    assert!(result.is_err());

    proxy.reveal_charge(&setup.subscription_id, &salt, &505, &1, &true);
    let sub = proxy.get_subscription(&setup.subscription_id);
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
