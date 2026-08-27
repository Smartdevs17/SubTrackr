use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use subtrackr_proxy::{UpgradeableProxy, UpgradeableProxyClient};
use subtrackr_storage::SubTrackrStorage;
use subtrackr_subscription::SubTrackrSubscription;
use subtrackr_types::{Interval, SubscriptionStatus};

const START_TS: u64 = 1_700_000_000;
const USER_COUNT: usize = 8;

pub struct Harness {
    pub env: Env,
    pub proxy_id: Address,
    pub token_id: Address,
    pub users: [Address; USER_COUNT],
}

impl Harness {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_timestamp(START_TS);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let users = [
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ];

        let storage_id = env.register_contract(None, SubTrackrStorage);
        let implementation_id = env.register_contract(None, SubTrackrSubscription);
        let proxy_id = env.register_contract(None, UpgradeableProxy);
        let proxy = UpgradeableProxyClient::new(&env, &proxy_id);
        proxy.initialize(&admin, &storage_id, &implementation_id, &0u64, &0u64);

        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_id = token_contract.address();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
        for user in users.iter() {
            token_admin_client.mint(user, &10_000_000_000);
        }

        Self {
            env,
            proxy_id,
            token_id,
            users,
        }
    }

    pub fn proxy(&self) -> UpgradeableProxyClient<'_> {
        UpgradeableProxyClient::new(&self.env, &self.proxy_id)
    }

    pub fn user(&self, raw: u8) -> Address {
        self.users[usize::from(raw) % USER_COUNT].clone()
    }

    pub fn interval(raw: u8) -> Interval {
        match raw % 5 {
            0 => Interval::Daily,
            1 => Interval::Weekly,
            2 => Interval::Monthly,
            3 => Interval::Quarterly,
            _ => Interval::Yearly,
        }
    }

    pub fn bounded_price(raw: u32) -> i128 {
        i128::from(raw % 1_000_000).saturating_add(1)
    }

    pub fn advance_time(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env
            .ledger()
            .set_timestamp(now.saturating_add(secs % (Interval::Yearly.seconds() * 2)));
    }
}

pub fn ignore_expected_panic<T>(f: impl FnOnce() -> T) -> Option<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok()
}

pub fn plan_name(env: &Env, byte: u8) -> String {
    match byte % 4 {
        0 => String::from_str(env, "basic"),
        1 => String::from_str(env, "pro"),
        2 => String::from_str(env, "team"),
        _ => String::from_str(env, "enterprise"),
    }
}

pub fn assert_subscription_invariants(h: &Harness) {
    let proxy = h.proxy();
    let plan_count = proxy.get_plan_count();
    let sub_count = proxy.get_subscription_count();

    let mut plan_id = 1u64;
    while plan_id <= plan_count.min(32) {
        let plan = proxy.get_plan(&plan_id);
        assert!(plan.price > 0);
        assert!(plan.created_at >= START_TS);
        plan_id += 1;
    }

    let mut sub_id = 1u64;
    while sub_id <= sub_count.min(32) {
        let sub = proxy.get_subscription(&sub_id);
        assert!(sub.next_charge_at >= sub.started_at);
        assert!(sub.total_paid >= 0);
        assert!(sub.refund_requested_amount >= 0);
        assert!(sub.refund_requested_amount <= sub.total_paid);
        match sub.status {
            SubscriptionStatus::Active
            | SubscriptionStatus::Paused
            | SubscriptionStatus::Cancelled
            | SubscriptionStatus::PastDue => {}
        }
        sub_id += 1;
    }
}
