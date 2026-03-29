use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use subtrackr::{Interval, SubTrackrContract, SubTrackrContractClient, SubscriptionStatus};

#[contract]
pub struct ChargingBot;

#[contractimpl]
impl ChargingBot {
    pub fn charge(env: Env, subtrackr_contract: Address, subscription_id: u64) {
        let subtrackr = SubTrackrContractClient::new(&env, &subtrackr_contract);
        subtrackr.charge_subscription(&subscription_id);
    }
}

struct IntegrationSetup {
    env: Env,
    subtrackr_id: Address,
    merchant: Address,
    subscriber: Address,
    token_id: Address,
    plan_id: u64,
    subscription_id: u64,
}

impl IntegrationSetup {
    fn subtrackr(&self) -> SubTrackrContractClient<'_> {
        SubTrackrContractClient::new(&self.env, &self.subtrackr_id)
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

    let subtrackr_id = env.register_contract(None, SubTrackrContract);
    let subtrackr = SubTrackrContractClient::new(&env, &subtrackr_id);
    subtrackr.initialize(&admin);

    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    token_admin_client.mint(&subscriber, &50_000);

    let plan_id = subtrackr.create_plan(
        &merchant,
        &String::from_str(&env, "Integration Plan"),
        &500,
        &token_id.address(),
        &Interval::Monthly,
    );
    let subscription_id = subtrackr.subscribe(&subscriber, &plan_id);

    IntegrationSetup {
        env,
        subtrackr_id,
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

    let subtrackr = setup.subtrackr();

    assert_eq!(subtrackr.get_plan_count(), 1);
    assert_eq!(subtrackr.get_subscription_count(), 1);

    let plan = subtrackr.get_plan(&setup.plan_id);
    assert!(plan.active);
    assert_eq!(plan.merchant, setup.merchant);
    assert_eq!(plan.price, 500);

    let sub = subtrackr.get_subscription(&setup.subscription_id);
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(sub.plan_id, setup.plan_id);

    let user_subs = subtrackr.get_user_subscriptions(&setup.subscriber);
    assert_eq!(user_subs.len(), 1);
    assert_eq!(user_subs.get_unchecked(0), setup.subscription_id);
}

#[test]
fn integration_uses_actual_token_contract_for_charges() {
    let setup = setup_integration();

    let subtrackr = setup.subtrackr();
    let token = setup.token();

    let subscriber_before = token.balance(&setup.subscriber);
    let merchant_before = token.balance(&setup.merchant);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 10);

    subtrackr.charge_subscription(&setup.subscription_id);

    let subscriber_after = token.balance(&setup.subscriber);
    let merchant_after = token.balance(&setup.merchant);

    assert_eq!(subscriber_before - subscriber_after, 500);
    assert_eq!(merchant_after - merchant_before, 500);

    let sub = subtrackr.get_subscription(&setup.subscription_id);
    assert_eq!(sub.total_paid, 500);
    assert_eq!(sub.charge_count, 1);
}

#[test]
fn integration_cross_contract_call_charges_subscription() {
    let setup = setup_integration();

    let subtrackr = setup.subtrackr();

    let bot_id = setup.env.register_contract(None, ChargingBot);
    let bot = ChargingBotClient::new(&setup.env, &bot_id);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 20);

    bot.charge(&setup.subtrackr_id, &setup.subscription_id);

    let sub = subtrackr.get_subscription(&setup.subscription_id);
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

    let subtrackr = setup.subtrackr();
    let token = setup.token();

    let second_plan_id = subtrackr.create_plan(
        &second_merchant,
        &String::from_str(&setup.env, "Premium Plan"),
        &900,
        &second_token_id.address(),
        &Interval::Monthly,
    );
    let second_subscription_id = subtrackr.subscribe(&setup.subscriber, &second_plan_id);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 30);

    subtrackr.charge_subscription(&setup.subscription_id);
    subtrackr.charge_subscription(&second_subscription_id);

    let sub1 = subtrackr.get_subscription(&setup.subscription_id);
    let sub2 = subtrackr.get_subscription(&second_subscription_id);

    assert_eq!(sub1.total_paid, 500);
    assert_eq!(sub2.total_paid, 900);

    assert_eq!(token.balance(&setup.merchant), 500);
    assert_eq!(second_token.balance(&second_merchant), 900);
}
