use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, SubscriptionStatus};

struct Setup {
    env: Env,
    proxy_id: Address,
    merchant: Address,
    subscriber: Address,
    token_id: Address,
}

impl Setup {
    fn proxy(&self) -> UpgradeableProxyClient<'_> {
        UpgradeableProxyClient::new(&self.env, &self.proxy_id)
    }
}

fn setup() -> Setup {
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

    let token = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = token.address();
    token::StellarAssetClient::new(&env, &token_id).mint(&subscriber, &1_000_000);

    Setup {
        env,
        proxy_id,
        merchant,
        subscriber,
        token_id,
    }
}

#[test]
fn fuzz_smoke_replays_subscription_lifecycle_seed() {
    let setup = setup();
    let proxy = setup.proxy();

    let plan_id = proxy.create_plan(
        &setup.merchant,
        &String::from_str(&setup.env, "fuzz-smoke"),
        &500,
        &setup.token_id,
        &Interval::Monthly,
    );
    let sub_id = proxy.subscribe(&setup.subscriber, &plan_id);

    setup
        .env
        .ledger()
        .set_timestamp(1_700_000_000 + Interval::Monthly.seconds() + 1);
    proxy.charge_subscription(&sub_id);

    let sub = proxy.get_subscription(&sub_id);
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(sub.total_paid, 500);
    assert_eq!(sub.charge_count, 1);
    assert!(sub.next_charge_at > sub.last_charged_at);
}
