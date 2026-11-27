// On-chain cancellation proofs anchored by a Soroban event (#2027).
//
//   cargo test --manifest-path contracts/subscription/Cargo.toml \
//       --test cancellation_proof

#![allow(deprecated)] // env.register_contract(..) deprecation

use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token, Address, BytesN, Env, IntoVal, String, Val, Vec,
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
fn no_proof_before_cancellation() {
    let s = setup();
    let user = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&user, &s.plan_id);
    assert!(s
        .imp()
        .get_cancellation_proof(&s.proxy_id, &s.storage_id, &sub)
        .is_none());
    let bogus = BytesN::from_array(&s.env, &[7u8; 32]);
    assert!(!s
        .imp()
        .verify_cancellation_proof(&s.proxy_id, &s.storage_id, &sub, &bogus));
}

#[test]
fn cancellation_stores_a_verifiable_proof() {
    let s = setup();
    let user = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&user, &s.plan_id);

    s.env.ledger().set_timestamp(START_TS + 5_000);
    s.proxy().cancel_subscription(&user, &sub);

    let proof = s
        .imp()
        .get_cancellation_proof(&s.proxy_id, &s.storage_id, &sub)
        .expect("proof stored");
    assert_eq!(proof.subscription_id, sub);
    assert_eq!(proof.plan_id, s.plan_id);
    assert_eq!(proof.subscriber, user);
    assert_eq!(proof.cancelled_at, START_TS + 5_000);

    assert!(s
        .imp()
        .verify_cancellation_proof(&s.proxy_id, &s.storage_id, &sub, &proof.digest));
}

#[test]
fn verification_rejects_a_wrong_digest_and_a_wrong_subscription() {
    let s = setup();
    let user = Address::generate(&s.env);
    let other = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&user, &s.plan_id);
    let other_sub = s.proxy().subscribe(&other, &s.plan_id);
    s.proxy().cancel_subscription(&user, &sub);

    let proof = s
        .imp()
        .get_cancellation_proof(&s.proxy_id, &s.storage_id, &sub)
        .unwrap();

    let mut tampered = proof.digest.to_array();
    tampered[0] ^= 0xff;
    let tampered = BytesN::from_array(&s.env, &tampered);
    assert!(!s
        .imp()
        .verify_cancellation_proof(&s.proxy_id, &s.storage_id, &sub, &tampered));

    // The other subscription was never cancelled, so the digest proves nothing for it.
    assert!(!s.imp().verify_cancellation_proof(
        &s.proxy_id,
        &s.storage_id,
        &other_sub,
        &proof.digest
    ));
}

#[test]
fn digest_binds_the_cancellation_facts() {
    let s = setup();
    let user_a = Address::generate(&s.env);
    let user_b = Address::generate(&s.env);
    let sub_a = s.proxy().subscribe(&user_a, &s.plan_id);
    let sub_b = s.proxy().subscribe(&user_b, &s.plan_id);

    // Same ledger timestamp and sequence, different subscription and subscriber.
    s.proxy().cancel_subscription(&user_a, &sub_a);
    s.proxy().cancel_subscription(&user_b, &sub_b);

    let a = s
        .imp()
        .get_cancellation_proof(&s.proxy_id, &s.storage_id, &sub_a)
        .unwrap();
    let b = s
        .imp()
        .get_cancellation_proof(&s.proxy_id, &s.storage_id, &sub_b)
        .unwrap();
    assert_ne!(a.digest, b.digest);
}

#[test]
fn cancellation_emits_the_anchoring_event() {
    let s = setup();
    let user = Address::generate(&s.env);
    let sub = s.proxy().subscribe(&user, &s.plan_id);

    // Call the implementation directly so the event list holds only this invocation.
    s.imp()
        .cancel_subscription(&s.proxy_id, &s.storage_id, &user, &sub);
    let events = s.env.events().all().filter_by_contract(&s.impl_id);
    let sequence = s.env.ledger().sequence();

    // Reading the proof is another invocation, so it comes after the event capture.
    let proof = s
        .imp()
        .get_cancellation_proof(&s.proxy_id, &s.storage_id, &sub)
        .unwrap();
    assert_eq!(proof.ledger_sequence, sequence);

    let topics: Vec<Val> = soroban_sdk::vec![
        &s.env,
        String::from_str(&s.env, "cancel_proof").into_val(&s.env),
        user.clone().into_val(&s.env),
    ];
    let data: Val = (sub, proof.digest.clone(), START_TS, sequence).into_val(&s.env);
    assert_eq!(
        events,
        soroban_sdk::vec![&s.env, (s.impl_id.clone(), topics, data)]
    );
}
