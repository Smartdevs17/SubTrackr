use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
use soroban_sdk::{token, Address, Env, String};
use subtrackr_storage::{SubTrackrStorage, SubTrackrStorageClient};
use subtrackr_subscription::{SubTrackrSubscription, SubTrackrSubscriptionClient};
use subtrackr_types::{Interval, SubscriptionStatus};

const START_TIME: u64 = 1_700_000_000;
const TOKEN_MINT: i128 = 1_000_000_000;

struct Harness {
    env: Env,
    subscription: Address,
    proxy: Address,
    storage: Address,
    merchant: Address,
}

impl Harness {
    fn new() -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.ledger().set_timestamp(START_TIME);

        let proxy = Address::generate(&env);
        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let subscription = env.register_contract(None, SubTrackrSubscription);
        let storage = env.register_contract(None, SubTrackrStorage);
        let storage_client = SubTrackrStorageClient::new(&env, &storage);
        let subscription_client = SubTrackrSubscriptionClient::new(&env, &subscription);

        storage_client.initialize(&admin, &subscription);
        subscription_client.initialize(&proxy, &storage, &admin);

        Self {
            env,
            subscription,
            proxy,
            storage,
            merchant,
        }
    }

    fn client(&self) -> SubTrackrSubscriptionClient<'_> {
        SubTrackrSubscriptionClient::new(&self.env, &self.subscription)
    }

    fn make_token(&self, mint_to: &Address) -> Address {
        let token_admin = Address::generate(&self.env);
        let token_id = self
            .env
            .register_stellar_asset_contract_v2(token_admin.clone());
        let asset_client = token::StellarAssetClient::new(&self.env, &token_id.address());
        asset_client.mint(mint_to, &TOKEN_MINT);
        token_id.address()
    }

    fn create_plan(&self, price: i128, interval: Interval) -> (u64, Address) {
        let token = self.make_token(&self.merchant);
        let plan_id = self.client().create_plan(
            &self.proxy,
            &self.storage,
            &self.merchant,
            &String::from_str(&self.env, "property-plan"),
            &price,
            &token,
            &interval,
        );
        (plan_id, token)
    }

    fn subscribe(&self, plan_id: u64, token: &Address) -> (u64, Address) {
        let subscriber = Address::generate(&self.env);
        let asset_client = token::StellarAssetClient::new(&self.env, token);
        asset_client.mint(&subscriber, &TOKEN_MINT);

        let subscription_id =
            self.client()
                .subscribe(&self.proxy, &self.storage, &subscriber, &plan_id);
        (subscription_id, subscriber)
    }

    fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|ledger| {
            ledger.timestamp += seconds;
        });
    }

    fn charge(&self, subscription_id: u64, interval: &Interval) {
        self.advance_time(interval.seconds() + 1);
        self.client()
            .charge_subscription(&self.proxy, &self.storage, &subscription_id);
    }
}

fn interval_strategy() -> impl Strategy<Value = Interval> {
    prop_oneof![
        Just(Interval::Daily),
        Just(Interval::Weekly),
        Just(Interval::Monthly),
        Just(Interval::Quarterly),
        Just(Interval::Yearly),
    ]
}

#[derive(Debug, Clone)]
enum LifecycleAction {
    Charge,
    Pause(u64),
    Resume,
    RequestRefund(u8),
    ApproveRefund,
    RejectRefund,
    Cancel,
}

fn lifecycle_action_strategy() -> impl Strategy<Value = LifecycleAction> {
    prop_oneof![
        4 => Just(LifecycleAction::Charge),
        2 => (1u64..=2_592_000u64).prop_map(LifecycleAction::Pause),
        2 => Just(LifecycleAction::Resume),
        2 => (1u8..=100u8).prop_map(LifecycleAction::RequestRefund),
        1 => Just(LifecycleAction::ApproveRefund),
        1 => Just(LifecycleAction::RejectRefund),
        1 => Just(LifecycleAction::Cancel),
    ]
}

fn proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: std::env::var("PROPTEST_CASES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(64),
        max_shrink_iters: std::env::var("PROPTEST_MAX_SHRINK_ITERS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(10_000),
        failure_persistence: None,
        ..ProptestConfig::default()
    }
}

proptest! {
    #![proptest_config(proptest_config())]

    #[test]
    fn prop_created_plan_count_matches_successful_plan_creations(
        prices in prop::collection::vec(1i128..50_000i128, 1..20),
        interval in interval_strategy(),
    ) {
        let h = Harness::new();

        for price in &prices {
            h.create_plan(*price, interval.clone());
        }

        prop_assert_eq!(
            h.client().get_plan_count(&h.proxy, &h.storage),
            prices.len() as u64
        );
    }

    #[test]
    fn prop_repeated_charges_preserve_subscription_accounting(
        price in 1i128..25_000i128,
        charges in 1u32..8u32,
        interval in interval_strategy(),
    ) {
        let h = Harness::new();
        let (plan_id, token) = h.create_plan(price, interval.clone());
        let (subscription_id, _subscriber) = h.subscribe(plan_id, &token);

        for expected_charge_count in 1..=charges {
            h.charge(subscription_id, &interval);
            let sub = h
                .client()
                .get_subscription(&h.proxy, &h.storage, &subscription_id);

            prop_assert_eq!(sub.status, SubscriptionStatus::Active);
            prop_assert_eq!(sub.charge_count, expected_charge_count);
            prop_assert_eq!(sub.total_paid, price * expected_charge_count as i128);
            prop_assert_eq!(sub.refund_requested_amount, 0);
            prop_assert!(sub.next_charge_at > sub.last_charged_at);
        }

        let plan = h.client().get_plan(&h.proxy, &h.storage, &plan_id);
        prop_assert_eq!(plan.subscriber_count, 1);
    }

    #[test]
    fn prop_lifecycle_actions_preserve_core_invariants(
        price in 1i128..10_000i128,
        interval in interval_strategy(),
        actions in prop::collection::vec(lifecycle_action_strategy(), 3..30),
    ) {
        let h = Harness::new();
        let (plan_id, token) = h.create_plan(price, interval.clone());
        let (subscription_id, subscriber) = h.subscribe(plan_id, &token);

        let mut expected_status = SubscriptionStatus::Active;
        let mut expected_total_paid = 0i128;
        let mut expected_charge_count = 0u32;
        let mut expected_pending_refund = 0i128;

        for action in actions {
            match action {
                LifecycleAction::Charge if expected_status == SubscriptionStatus::Active => {
                    h.charge(subscription_id, &interval);
                    expected_total_paid += price;
                    expected_charge_count += 1;
                }
                LifecycleAction::Pause(duration) if expected_status == SubscriptionStatus::Active => {
                    h.client().pause_by_subscriber(
                        &h.proxy,
                        &h.storage,
                        &subscriber,
                        &subscription_id,
                        &duration,
                    );
                    expected_status = SubscriptionStatus::Paused;
                }
                LifecycleAction::Resume if expected_status == SubscriptionStatus::Paused => {
                    h.client().resume_subscription(
                        &h.proxy,
                        &h.storage,
                        &subscriber,
                        &subscription_id,
                    );
                    expected_status = SubscriptionStatus::Active;
                }
                LifecycleAction::RequestRefund(percent)
                    if expected_total_paid > 0 && expected_pending_refund == 0 =>
                {
                    let amount = core::cmp::max(
                        1,
                        expected_total_paid * percent as i128 / 100,
                    );
                    h.client()
                        .request_refund(&h.proxy, &h.storage, &subscription_id, &amount);
                    expected_pending_refund = amount;
                }
                LifecycleAction::ApproveRefund if expected_pending_refund > 0 => {
                    h.client()
                        .approve_refund(&h.proxy, &h.storage, &subscription_id);
                    expected_total_paid -= expected_pending_refund;
                    expected_pending_refund = 0;
                }
                LifecycleAction::RejectRefund if expected_pending_refund > 0 => {
                    h.client()
                        .reject_refund(&h.proxy, &h.storage, &subscription_id);
                    expected_pending_refund = 0;
                }
                LifecycleAction::Cancel
                    if expected_status == SubscriptionStatus::Active
                        || expected_status == SubscriptionStatus::Paused =>
                {
                    h.client().cancel_subscription(
                        &h.proxy,
                        &h.storage,
                        &subscriber,
                        &subscription_id,
                    );
                    expected_status = SubscriptionStatus::Cancelled;
                }
                _ => {}
            }

            let sub = h
                .client()
                .get_subscription(&h.proxy, &h.storage, &subscription_id);
            let plan = h.client().get_plan(&h.proxy, &h.storage, &plan_id);
            let user_subs =
                h.client()
                    .get_user_subscriptions(&h.proxy, &h.storage, &subscriber);

            prop_assert_eq!(sub.status, expected_status.clone());
            prop_assert_eq!(sub.total_paid, expected_total_paid);
            prop_assert_eq!(sub.charge_count, expected_charge_count);
            prop_assert_eq!(sub.refund_requested_amount, expected_pending_refund);
            prop_assert!(sub.refund_requested_amount <= sub.total_paid);
            prop_assert!(sub.total_paid >= 0);
            prop_assert_eq!(
                plan.subscriber_count,
                if expected_status == SubscriptionStatus::Cancelled { 0 } else { 1 }
            );
            prop_assert_eq!(user_subs.len(), 1);
            prop_assert_eq!(user_subs.get_unchecked(0), subscription_id);
        }
    }
}

#[test]
fn deterministic_invalid_refund_cannot_exceed_total_paid() {
    let h = Harness::new();
    let (plan_id, token) = h.create_plan(100, Interval::Monthly);
    let (subscription_id, _subscriber) = h.subscribe(plan_id, &token);

    let result = h
        .client()
        .try_request_refund(&h.proxy, &h.storage, &subscription_id, &1);

    assert!(result.is_err(), "refund before payment should be rejected");
}
