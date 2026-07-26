use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger, Env as _},
    token, Address, Env, String,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, SubscriptionStatus};

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
        merchant,
        subscriber,
        token_id: token_id.address(),
        plan_id,
        subscription_id,
    }
}

fn setup_proxy_only() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(1_700_000_000);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);

    let storage_id = env.register_contract(None, SubTrackrStorage);
    let implementation_id = env.register_contract(None, SubTrackrSubscription);

    let proxy_id = env.register_contract(None, UpgradeableProxy);
    let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
    proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

    (env, proxy_id, admin, merchant)
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
fn integration_plan_limit_blocks_third_plan() {
    let (env, proxy_id, _admin, merchant) = setup_proxy_only();
    let proxy = UpgradeableProxyClient::new(&env, &proxy_id);

    proxy.set_max_plans_per_merchant(&2u32);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    let name = String::from_str(&env, "Limited Plan");
    proxy.create_plan(
        &merchant,
        &name,
        &500,
        &token_id.address(),
        &Interval::Monthly,
    );
    proxy.create_plan(
        &merchant,
        &name,
        &600,
        &token_id.address(),
        &Interval::Monthly,
    );

    let res = proxy.try_create_plan(
        &merchant,
        &name,
        &700,
        &token_id.address(),
        &Interval::Monthly,
    );
    assert!(res.is_err());
}

#[test]
fn integration_lowering_plan_limit_does_not_affect_existing_plans() {
    let (env, proxy_id, _admin, merchant) = setup_proxy_only();
    let proxy = UpgradeableProxyClient::new(&env, &proxy_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let name = String::from_str(&env, "Plan");

    let p1 = proxy.create_plan(
        &merchant,
        &name,
        &100,
        &token_id.address(),
        &Interval::Monthly,
    );
    let p2 = proxy.create_plan(
        &merchant,
        &name,
        &200,
        &token_id.address(),
        &Interval::Monthly,
    );
    let p3 = proxy.create_plan(
        &merchant,
        &name,
        &300,
        &token_id.address(),
        &Interval::Monthly,
    );

    proxy.set_max_plans_per_merchant(&2u32);

    assert!(proxy.get_plan(&p1).active);
    assert!(proxy.get_plan(&p2).active);
    assert!(proxy.get_plan(&p3).active);

    let res = proxy.try_create_plan(
        &merchant,
        &name,
        &400,
        &token_id.address(),
        &Interval::Monthly,
    );
    assert!(res.is_err());
}

fn setup_client_helper(env: &Env) -> (UpgradeableProxyClient<'_>, Address, Address, Address, Address) {
    env.mock_all_auths_allowing_non_root_auth();
    
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    let subscriber = Address::generate(env);
    let token_admin = Address::generate(env);

    let storage_id = env.register_contract(None, SubTrackrStorage);
    let implementation_id = env.register_contract(None, SubTrackrSubscription);

    let proxy_id = env.register_contract(None, UpgradeableProxy);
    let proxy = UpgradeableProxyClient::new(env, &proxy_id);
    proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    
    (proxy, admin, merchant, subscriber, token_id.address())
}

#[test]
fn test_gas_benchmarks() {
    // We will run each benchmarked function and print the cost.
    // 1. initialize
    {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let admin = Address::generate(&env);
        let storage_id = env.register_contract(None, SubTrackrStorage);
        let implementation_id = env.register_contract(None, SubTrackrSubscription);
        let proxy_id = env.register_contract(None, UpgradeableProxy);
        let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
        
        env.enable_invocation_metering();
        proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:initialize:{:?}", resources);
    }
    
    // Helper to get initialized contract client
    let setup_client = setup_client_helper;

    // 2. create_plan
    {
        let env = Env::default();
        let (client, _admin, merchant, _subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        
        env.enable_invocation_metering();
        let _plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:create_plan:{:?}", resources);
    }

    // 3. deactivate_plan
    {
        let env = Env::default();
        let (client, _admin, merchant, _subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        
        env.enable_invocation_metering();
        client.deactivate_plan(&merchant, &plan_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:deactivate_plan:{:?}", resources);
    }

    // 4. subscribe
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        
        env.enable_invocation_metering();
        let _sub_id = client.subscribe(&subscriber, &plan_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:subscribe:{:?}", resources);
    }

    // 5. cancel_subscription
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        env.enable_invocation_metering();
        client.cancel_subscription(&subscriber, &sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:cancel_subscription:{:?}", resources);
    }

    // 6. pause_subscription
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        env.enable_invocation_metering();
        client.pause_subscription(&subscriber, &sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:pause_subscription:{:?}", resources);
    }

    // 7. pause_by_subscriber
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        env.enable_invocation_metering();
        client.pause_by_subscriber(&subscriber, &sub_id, &1000_u64);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:pause_by_subscriber:{:?}", resources);
    }

    // 8. resume_subscription
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        client.pause_subscription(&subscriber, &sub_id);
        
        env.enable_invocation_metering();
        client.resume_subscription(&subscriber, &sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:resume_subscription:{:?}", resources);
    }

    // 9. charge_subscription
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        let token_admin_client = token::StellarAssetClient::new(&env, &token);
        token_admin_client.mint(&subscriber, &1000);
        
        env.ledger().set_timestamp(env.ledger().timestamp() + Interval::Monthly.seconds() + 10);
        
        env.enable_invocation_metering();
        client.charge_subscription(&sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:charge_subscription:{:?}", resources);
    }

    // 10. request_refund
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        let token_admin_client = token::StellarAssetClient::new(&env, &token);
        token_admin_client.mint(&subscriber, &1000);
        
        env.ledger().set_timestamp(env.ledger().timestamp() + Interval::Monthly.seconds() + 10);
        client.charge_subscription(&sub_id);
        
        env.enable_invocation_metering();
        client.request_refund(&sub_id, &50_i128);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:request_refund:{:?}", resources);
    }

    // 11. approve_refund
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        let token_admin_client = token::StellarAssetClient::new(&env, &token);
        token_admin_client.mint(&subscriber, &1000);
        
        env.ledger().set_timestamp(env.ledger().timestamp() + Interval::Monthly.seconds() + 10);
        client.charge_subscription(&sub_id);
        client.request_refund(&sub_id, &50_i128);
        
        env.enable_invocation_metering();
        client.approve_refund(&sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:approve_refund:{:?}", resources);
    }

    // 12. reject_refund
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        let token_admin_client = token::StellarAssetClient::new(&env, &token);
        token_admin_client.mint(&subscriber, &1000);
        
        env.ledger().set_timestamp(env.ledger().timestamp() + Interval::Monthly.seconds() + 10);
        client.charge_subscription(&sub_id);
        client.request_refund(&sub_id, &50_i128);
        
        env.enable_invocation_metering();
        client.reject_refund(&sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:reject_refund:{:?}", resources);
    }

    // 13. request_transfer
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        let recipient = Address::generate(&env);
        
        env.enable_invocation_metering();
        client.request_transfer(&sub_id, &recipient);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:request_transfer:{:?}", resources);
    }

    // 14. accept_transfer
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        let recipient = Address::generate(&env);
        client.request_transfer(&sub_id, &recipient);
        
        env.enable_invocation_metering();
        client.accept_transfer(&sub_id, &recipient);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:accept_transfer:{:?}", resources);
    }

    // 15. get_plan
    {
        let env = Env::default();
        let (client, _admin, merchant, _subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        
        env.enable_invocation_metering();
        let _plan = client.get_plan(&plan_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:get_plan:{:?}", resources);
    }

    // 16. get_subscription
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let sub_id = client.subscribe(&subscriber, &plan_id);
        
        env.enable_invocation_metering();
        let _sub = client.get_subscription(&sub_id);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:get_subscription:{:?}", resources);
    }

    // 17. get_user_subscriptions
    {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        let _sub_id = client.subscribe(&subscriber, &plan_id);
        
        env.enable_invocation_metering();
        let _subs = client.get_user_subscriptions(&subscriber);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:get_user_subscriptions:{:?}", resources);
    }

    // 18. get_merchant_plans
    {
        let env = Env::default();
        let (client, _admin, merchant, _subscriber, token) = setup_client(&env);
        let name = String::from_str(&env, "Standard Plan");
        let _plan_id = client.create_plan(&merchant, &name, &100_i128, &token, &Interval::Monthly);
        
        env.enable_invocation_metering();
        let _plans = client.get_merchant_plans(&merchant);
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:get_merchant_plans:{:?}", resources);
    }

    // 19. get_plan_count
    {
        let env = Env::default();
        let (client, _admin, _merchant, _subscriber, _token) = setup_client(&env);
        
        env.enable_invocation_metering();
        let _count = client.get_plan_count();
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:get_plan_count:{:?}", resources);
    }

    // 20. get_subscription_count
    {
        let env = Env::default();
        let (client, _admin, _merchant, _subscriber, _token) = setup_client(&env);
        
        env.enable_invocation_metering();
        let _count = client.get_subscription_count();
        let resources = env.cost_estimate().resources();
        println!("GAS_BENCHMARK:get_subscription_count:{:?}", resources);
    }
}
