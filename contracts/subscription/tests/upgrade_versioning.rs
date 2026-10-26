// Upgradeability & storage-versioning tests for the subscription contract
// (issue #1809 — Add contract upgradeability plan).
//
// These exercise the REAL subscription contract's upgrade hooks
// (`get_version`, `validate_upgrade`, `migrate`) together with the real
// UpgradeableProxy + SubTrackrStorage contracts — not mocks — proving that
// the versioning scheme, compatibility gates, and v1→v2 migration actually
// work end-to-end.
//
//   cargo test --manifest-path contracts/subscription/Cargo.toml \
//       --test upgrade_versioning

#![allow(deprecated)] // env.register_contract(..) deprecation

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, IntoVal, String, TryFromVal, Val,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::{SubTrackrStorage, SubTrackrStorageClient};
use subtrackr_subscription::{SubTrackrSubscription, SubTrackrSubscriptionClient};
use subtrackr_types::{Interval, StorageKey};

const START_TS: u64 = 1_700_000_000;

struct Setup {
    env: Env,
    proxy_id: Address,
    storage_id: Address,
    impl_id: Address,
    merchant: Address,
    token_id: Address,
}

impl Setup {
    fn proxy(&self) -> UpgradeableProxyClient<'_> {
        UpgradeableProxyClient::new(&self.env, &self.proxy_id)
    }
    fn impl_client(&self) -> SubTrackrSubscriptionClient<'_> {
        SubTrackrSubscriptionClient::new(&self.env, &self.impl_id)
    }
    fn storage(&self) -> SubTrackrStorageClient<'_> {
        SubTrackrStorageClient::new(&self.env, &self.storage_id)
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
    // Zero-second upgrade/rollback delays so timelocks elapse immediately.
    proxy.initialize(&admin, &storage_id, &impl_id, &0u64, &0u64);

    let token = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = token.address();
    token::StellarAssetClient::new(&env, &token_id).mint(&merchant, &1_000_000_000);

    Setup { env, proxy_id, storage_id, impl_id, merchant, token_id }
}

/// Read the UserPlanIndex(subscriber, plan_id) entry from storage, if any.
fn user_plan_index(setup: &Setup, subscriber: &Address, plan_id: u64) -> Option<u64> {
    let key: Val = StorageKey::UserPlanIndex(subscriber.clone(), plan_id).into_val(&setup.env);
    let val_opt: Option<Val> = setup.storage().persistent_get(&key);
    val_opt.map(|v| u64::try_from_val(&setup.env, &v).unwrap())
}

/// Remove the UserPlanIndex entry, simulating a pre-v2 (v1) storage state
/// where the index did not exist.
fn remove_user_plan_index(setup: &Setup, subscriber: &Address, plan_id: u64) {
    let key: Val = StorageKey::UserPlanIndex(subscriber.clone(), plan_id).into_val(&setup.env);
    setup.storage().persistent_remove(&key);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[test]
fn get_version_reports_current_storage_version() {
    let s = setup();
    // STORAGE_VERSION is currently 2 (see contracts/subscription/src/lib.rs).
    let version = s.impl_client().get_version(&s.proxy_id, &s.storage_id);
    assert_eq!(version, 2, "get_version must return the current STORAGE_VERSION");
}

#[test]
fn validate_upgrade_accepts_current_and_prior_versions() {
    let s = setup();
    // Upgrading from v1 or from the current v2 must be accepted.
    s.impl_client().validate_upgrade(&s.proxy_id, &s.storage_id, &1u32);
    s.impl_client().validate_upgrade(&s.proxy_id, &s.storage_id, &2u32);
}

#[test]
fn validate_upgrade_rejects_zero_and_future_versions() {
    let s = setup();
    let client = s.impl_client();
    // from_version == 0 is invalid.
    let zero = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.validate_upgrade(&s.proxy_id, &s.storage_id, &0u32);
    }));
    assert!(zero.is_err(), "validate_upgrade must reject from_version 0");

    // from_version > STORAGE_VERSION is a future/unsupported version.
    let future = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.validate_upgrade(&s.proxy_id, &s.storage_id, &3u32);
    }));
    assert!(future.is_err(), "validate_upgrade must reject future versions");
}

#[test]
fn migrate_is_a_noop_when_already_at_current_version() {
    let s = setup();
    // Migrating from the current version must be a safe no-op.
    s.impl_client().migrate(&s.proxy_id, &s.storage_id, &2u32);
    // Version is still consistent.
    assert_eq!(s.impl_client().get_version(&s.proxy_id, &s.storage_id), 2);
}

#[test]
fn migrate_rejects_unsupported_future_path() {
    let s = setup();
    let client = s.impl_client();
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.migrate(&s.proxy_id, &s.storage_id, &3u32);
    }));
    assert!(res.is_err(), "migrate must reject from_version > STORAGE_VERSION");
}

#[test]
fn migrate_v1_to_v2_rebuilds_user_plan_index_for_active_only() {
    let s = setup();
    let proxy = s.proxy();

    // One plan, two subscribers.
    let plan_id = proxy.create_plan(
        &s.merchant,
        &String::from_str(&s.env, "pro"),
        &500,
        &s.token_id,
        &Interval::Monthly,
    );

    let user_a = Address::generate(&s.env);
    let user_b = Address::generate(&s.env);

    let sub_a = proxy.subscribe(&user_a, &plan_id);
    let sub_b = proxy.subscribe(&user_b, &plan_id);

    // v2 keeps the index for active subscriptions.
    assert_eq!(user_plan_index(&s, &user_a, plan_id), Some(sub_a));
    assert_eq!(user_plan_index(&s, &user_b, plan_id), Some(sub_b));

    // Cancel user_b — cancellation removes its index entry.
    proxy.cancel_subscription(&user_b, &sub_b);
    assert_eq!(user_plan_index(&s, &user_b, plan_id), None);

    // Simulate a v1 snapshot: the UserPlanIndex did not exist in v1, so
    // drop the remaining active entry before running the migration.
    remove_user_plan_index(&s, &user_a, plan_id);
    assert_eq!(user_plan_index(&s, &user_a, plan_id), None);

    // Run the v1→v2 migration directly against the real contract.
    s.impl_client().migrate(&s.proxy_id, &s.storage_id, &1u32);

    // The active subscription's index is rebuilt...
    assert_eq!(
        user_plan_index(&s, &user_a, plan_id),
        Some(sub_a),
        "migrate must rebuild UserPlanIndex for active subscriptions",
    );
    // ...and the cancelled subscription is intentionally NOT re-indexed.
    assert_eq!(
        user_plan_index(&s, &user_b, plan_id),
        None,
        "migrate must not index cancelled subscriptions",
    );
}

#[test]
fn proxy_version_tracks_implementation_version_after_initialize() {
    let s = setup();
    // During initialize the proxy adopts the implementation's STORAGE_VERSION
    // so that subsequent upgrades can gate on a correct baseline.
    assert_eq!(
        s.proxy().get_version(),
        s.impl_client().get_version(&s.proxy_id, &s.storage_id),
        "proxy version must track the implementation's STORAGE_VERSION",
    );
    assert_eq!(s.proxy().get_version(), 2u32);
}
