// Family plan support with a shared paying wallet (#2031).
//
//   cargo test --manifest-path contracts/subscription/Cargo.toml \
//       --test family_plan

#![allow(deprecated)] // env.register_contract(..) deprecation

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::{SubTrackrSubscription, SubTrackrSubscriptionClient};
use subtrackr_types::Interval;

const START_TS: u64 = 1_700_000_000;

struct Setup {
    env: Env,
    proxy_id: Address,
    storage_id: Address,
    impl_id: Address,
    plan_id: u64,
}

impl Setup {
    fn proxy(&self) -> UpgradeableProxyClient<'_> {
        UpgradeableProxyClient::new(&self.env, &self.proxy_id)
    }
    fn imp(&self) -> SubTrackrSubscriptionClient<'_> {
        SubTrackrSubscriptionClient::new(&self.env, &self.impl_id)
    }
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(START_TS);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let storage_id = env.register_contract(None, SubTrackrStorage);
    let impl_id = env.register_contract(None, SubTrackrSubscription);
    let proxy_id = env.register_contract(None, UpgradeableProxy);
    let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
    proxy.initialize(&admin, &storage_id, &impl_id, &0u64, &0u64);

    let token_id = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    token::StellarAssetClient::new(&env, &token_id).mint(&merchant, &1_000_000_000);

    let plan_id = proxy.create_plan(
        &merchant,
        &String::from_str(&env, "pro"),
        &500,
        &token_id,
        &Interval::Monthly,
    );

    Setup {
        env,
        proxy_id,
        storage_id,
        impl_id,
        plan_id,
    }
}

#[test]
fn payer_creates_a_group_and_adds_members() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let kid = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);

    let group = s
        .imp()
        .create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &4);
    assert_eq!(group.payer, payer);
    assert_eq!(group.max_seats, 4);
    assert_eq!(group.members.len(), 0);

    let group = s
        .imp()
        .add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &kid);
    assert_eq!(group.members.len(), 1);

    let imp = s.imp();
    assert!(imp.has_family_access(&s.proxy_id, &s.storage_id, &sub, &kid));
    assert!(imp.has_family_access(&s.proxy_id, &s.storage_id, &sub, &payer));
    let stranger = Address::generate(&s.env);
    assert!(!imp.has_family_access(&s.proxy_id, &s.storage_id, &sub, &stranger));
}

#[test]
fn only_the_paying_wallet_manages_the_group() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let other = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);

    assert!(s
        .imp()
        .try_create_family_group(&s.proxy_id, &s.storage_id, &other, &sub, &3)
        .is_err());

    s.imp()
        .create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &3);
    assert!(s
        .imp()
        .try_add_family_member(&s.proxy_id, &s.storage_id, &other, &sub, &other)
        .is_err());
}

#[test]
fn seat_limit_duplicates_and_payer_seat_are_enforced() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let a = Address::generate(&s.env);
    let b = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);

    // Two seats: the payer and one member.
    s.imp()
        .create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &2);
    s.imp()
        .add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &a);

    assert!(s
        .imp()
        .try_add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &b)
        .is_err());
    assert!(s
        .imp()
        .try_add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &a)
        .is_err());
    assert!(s
        .imp()
        .try_add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &payer)
        .is_err());
}

#[test]
fn seat_count_bounds_are_validated_and_duplicate_groups_rejected() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);
    let imp = s.imp();

    assert!(imp
        .try_create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &1)
        .is_err());
    assert!(imp
        .try_create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &11)
        .is_err());
    imp.create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &10);
    assert!(imp
        .try_create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &5)
        .is_err());
}

#[test]
fn payer_can_remove_and_member_can_leave() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let a = Address::generate(&s.env);
    let b = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);
    let imp = s.imp();

    imp.create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &4);
    imp.add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &a);
    imp.add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &b);

    let group = imp.remove_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &a);
    assert_eq!(group.members.len(), 1);
    assert!(!imp.has_family_access(&s.proxy_id, &s.storage_id, &sub, &a));

    let group = imp.leave_family_group(&s.proxy_id, &s.storage_id, &b, &sub);
    assert_eq!(group.members.len(), 0);
    assert!(!imp.has_family_access(&s.proxy_id, &s.storage_id, &sub, &b));

    // Removing someone who is not a member fails.
    assert!(imp
        .try_remove_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &a)
        .is_err());
    assert!(imp
        .try_leave_family_group(&s.proxy_id, &s.storage_id, &a, &sub)
        .is_err());
}

#[test]
fn cancelling_the_subscription_dissolves_the_group() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let kid = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);

    s.imp()
        .create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &3);
    s.imp()
        .add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &kid);

    s.env.ledger().set_timestamp(START_TS + 100);
    s.proxy().cancel_subscription(&payer, &sub);

    let imp = s.imp();
    assert!(imp
        .get_family_group(&s.proxy_id, &s.storage_id, &sub)
        .is_none());
    assert!(!imp.has_family_access(&s.proxy_id, &s.storage_id, &sub, &kid));
    // A cancelled subscription cannot start a new group.
    assert!(imp
        .try_create_family_group(&s.proxy_id, &s.storage_id, &payer, &sub, &3)
        .is_err());
}

#[test]
fn group_requires_an_existing_subscription_and_group() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let kid = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&payer, &s.plan_id);
    let imp = s.imp();

    assert!(imp
        .try_create_family_group(&s.proxy_id, &s.storage_id, &payer, &999, &3)
        .is_err());
    // No group yet.
    assert!(imp
        .try_add_family_member(&s.proxy_id, &s.storage_id, &payer, &sub, &kid)
        .is_err());
}
