#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// Billing interval in seconds
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Interval {
    Weekly,      // 604800s
    Monthly,     // 2592000s (30 days)
    Quarterly,   // 7776000s (90 days)
    Yearly,      // 31536000s (365 days)
}

const MAX_PAUSE_DURATION: u64 = 2_592_000; // 30 days

impl Interval {
    pub fn seconds(&self) -> u64 {
        match self {
            Interval::Weekly => 604_800,
            Interval::Monthly => 2_592_000,
            Interval::Quarterly => 7_776_000,
            Interval::Yearly => 31_536_000,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Paused,
    Cancelled,
    PastDue,
}

/// A subscription plan created by a merchant
#[contracttype]
#[derive(Clone, Debug)]
pub struct Plan {
    pub id: u64,
    pub merchant: Address,
    pub name: String,
    pub price: i128,           // price per interval in stroops (XLM smallest unit)
    pub token: Address,        // token address (native XLM or Stellar asset)
    pub interval: Interval,
    pub active: bool,
    pub subscriber_count: u32,
    pub created_at: u64,
}

/// A user's subscription to a plan
#[contracttype]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub status: SubscriptionStatus,
    pub started_at: u64,
    pub last_charged_at: u64,
    pub next_charge_at: u64,
    pub total_paid: i128,
    pub paused_at: u64,
    pub pause_duration: u64,
}

#[contracttype]
pub enum DataKey {
    Plan(u64),
    PlanCount,
    Subscription(u64),
    SubscriptionCount,
    UserSubscriptions(Address),
    MerchantPlans(Address),
    Admin,
}

#[contract]
pub struct SubTrackrContract;

#[contractimpl]
impl SubTrackrContract {
    /// Initialize the contract
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PlanCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::SubscriptionCount, &0u64);
    }

    // ── Plan Management ──

    /// Merchant creates a subscription plan
    pub fn create_plan(
        env: Env,
        merchant: Address,
        name: String,
        price: i128,
        token: Address,
        interval: Interval,
    ) -> u64 {
        merchant.require_auth();
        assert!(price > 0, "Price must be positive");

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PlanCount)
            .unwrap_or(0);
        count += 1;

        let plan = Plan {
            id: count,
            merchant: merchant.clone(),
            name,
            price,
            token,
            interval,
            active: true,
            subscriber_count: 0,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Plan(count), &plan);
        env.storage()
            .instance()
            .set(&DataKey::PlanCount, &count);

        // Track merchant's plans
        let mut merchant_plans: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::MerchantPlans(merchant.clone()))
            .unwrap_or(Vec::new(&env));
        merchant_plans.push_back(count);
        env.storage()
            .persistent()
            .set(&DataKey::MerchantPlans(merchant), &merchant_plans);

        count
    }

    /// Merchant deactivates a plan (no new subscribers, existing ones continue)
    pub fn deactivate_plan(env: Env, merchant: Address, plan_id: u64) {
        merchant.require_auth();

        let mut plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .expect("Plan not found");

        assert!(plan.merchant == merchant, "Only plan owner can deactivate");
        plan.active = false;

        env.storage()
            .persistent()
            .set(&DataKey::Plan(plan_id), &plan);
    }

    // ── Subscription Management ──

    /// User subscribes to a plan
    pub fn subscribe(env: Env, subscriber: Address, plan_id: u64) -> u64 {
        subscriber.require_auth();

        let mut plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .expect("Plan not found");
        assert!(plan.active, "Plan is not active");
        assert!(plan.merchant != subscriber, "Merchant cannot self-subscribe");

        let user_subs: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::UserSubscriptions(subscriber.clone()))
            .unwrap_or(Vec::new(&env));
        for sub_id in user_subs.iter() {
            let existing_sub: Subscription = env
                .storage()
                .persistent()
                .get(&DataKey::Subscription(sub_id))
                .expect("Subscription not found");
            if existing_sub.plan_id == plan_id
                && existing_sub.status != SubscriptionStatus::Cancelled
            {
                panic!("Already subscribed to this plan");
            }
        }

        let mut sub_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::SubscriptionCount)
            .unwrap_or(0);
        sub_count += 1;

        let now = env.ledger().timestamp();

        let subscription = Subscription {
            id: sub_count,
            plan_id,
            subscriber: subscriber.clone(),
            status: SubscriptionStatus::Active,
            started_at: now,
            last_charged_at: now,
            next_charge_at: now + plan.interval.seconds(),
            total_paid: 0,
            paused_at: 0,
            pause_duration: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(sub_count), &subscription);
        env.storage()
            .instance()
            .set(&DataKey::SubscriptionCount, &sub_count);

        // Track user's subscriptions
        let mut user_subs: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::UserSubscriptions(subscriber.clone()))
            .unwrap_or(Vec::new(&env));
        user_subs.push_back(sub_count);
        env.storage()
            .persistent()
            .set(&DataKey::UserSubscriptions(subscriber), &user_subs);

        // Increment plan subscriber count
        plan.subscriber_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Plan(plan_id), &plan);

        sub_count
    }

    /// User cancels their subscription
    pub fn cancel_subscription(env: Env, subscriber: Address, subscription_id: u64) {
        subscriber.require_auth();

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .expect("Subscription not found");

        assert!(
            sub.subscriber == subscriber,
            "Only subscriber can cancel"
        );
        assert!(
            sub.status == SubscriptionStatus::Active
                || sub.status == SubscriptionStatus::Paused,
            "Subscription not active"
        );

        sub.status = SubscriptionStatus::Cancelled;

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &sub);

        // Decrement plan subscriber count
        let mut plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(sub.plan_id))
            .expect("Plan not found");
        if plan.subscriber_count > 0 {
            plan.subscriber_count -= 1;
        }
        env.storage()
            .persistent()
            .set(&DataKey::Plan(sub.plan_id), &plan);
    }

    /// User pauses their subscription
    pub fn pause_subscription(env: Env, subscriber: Address, subscription_id: u64) {
        Self::pause_by_subscriber(env, subscriber, subscription_id, MAX_PAUSE_DURATION);
    }

    /// User pauses their subscription with a specific duration
    pub fn pause_by_subscriber(
        env: Env,
        subscriber: Address,
        subscription_id: u64,
        duration: u64,
    ) {
        subscriber.require_auth();

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .expect("Subscription not found");

        assert!(sub.subscriber == subscriber, "Only subscriber can pause");
        assert!(
            sub.status == SubscriptionStatus::Active,
            "Only active subscriptions can be paused"
        );
        assert!(
            duration <= MAX_PAUSE_DURATION,
            "Pause duration exceeds limit"
        );

        sub.status = SubscriptionStatus::Paused;
        sub.paused_at = env.ledger().timestamp();
        sub.pause_duration = duration;

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &sub);

        // Publish event
        env.events().publish(
            (String::from_str(&env, "subscription_paused"), subscriber),
            (subscription_id, sub.paused_at, duration),
        );
    }

    /// User resumes a paused subscription
    pub fn resume_subscription(env: Env, subscriber: Address, subscription_id: u64) {
        subscriber.require_auth();

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .expect("Subscription not found");

        assert!(sub.subscriber == subscriber, "Only subscriber can resume");
        assert!(
            sub.status == SubscriptionStatus::Paused
                || Self::check_and_resume_internal(&env, &mut sub),
            "Only paused subscriptions can be resumed"
        );

        let now = env.ledger().timestamp();
        let plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(sub.plan_id))
            .expect("Plan not found");

        sub.status = SubscriptionStatus::Active;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.paused_at = 0;
        sub.pause_duration = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &sub);

        // Publish event
        env.events().publish(
            (String::from_str(&env, "subscription_resumed"), subscriber),
            subscription_id,
        );
    }

    // ── Payment Processing ──

    /// Process a due payment for a subscription (callable by anyone — typically a cron/bot)
    pub fn charge_subscription(env: Env, subscription_id: u64) {
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .expect("Subscription not found");

        // Handle auto-resume if needed
        if Self::check_and_resume_internal(&env, &mut sub) {
            env.storage()
                .persistent()
                .set(&DataKey::Subscription(subscription_id), &sub);
        }

        assert!(
            sub.status == SubscriptionStatus::Active,
            "Subscription not active"
        );

        let now = env.ledger().timestamp();
        assert!(now >= sub.next_charge_at, "Payment not yet due");

        let plan: Plan = env
            .storage()
            .persistent()
            .get(&DataKey::Plan(sub.plan_id))
            .expect("Plan not found");

        // TODO: Execute actual token transfer from subscriber to merchant
        // token::Client::new(&env, &plan.token).transfer(
        //     &sub.subscriber, &plan.merchant, &plan.price
        // );

        sub.last_charged_at = now;
        sub.next_charge_at = now + plan.interval.seconds();
        sub.total_paid += plan.price;

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(subscription_id), &sub);
    }

    // ── Queries ──

    /// Get plan details
    pub fn get_plan(env: Env, plan_id: u64) -> Plan {
        env.storage()
            .persistent()
            .get(&DataKey::Plan(plan_id))
            .expect("Plan not found")
    }

    /// Get subscription details
    pub fn get_subscription(env: Env, subscription_id: u64) -> Subscription {
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_id))
            .expect("Subscription not found");

        Self::check_and_resume_internal(&env, &mut sub);
        sub
    }

    /// Get all subscription IDs for a user
    pub fn get_user_subscriptions(env: Env, subscriber: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::UserSubscriptions(subscriber))
            .unwrap_or(Vec::new(&env))
    }

    /// Get all plan IDs for a merchant
    pub fn get_merchant_plans(env: Env, merchant: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::MerchantPlans(merchant))
            .unwrap_or(Vec::new(&env))
    }

    /// Get total plan count
    pub fn get_plan_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::PlanCount)
            .unwrap_or(0)
    }

    /// Get total subscription count
    pub fn get_subscription_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::SubscriptionCount)
            .unwrap_or(0)
    }

    // ── Internal Helpers ──

    fn check_and_resume_internal(env: &Env, sub: &mut Subscription) -> bool {
        if sub.status == SubscriptionStatus::Paused {
            let now = env.ledger().timestamp();
            if now >= sub.paused_at + sub.pause_duration {
                sub.status = SubscriptionStatus::Active;
                sub.paused_at = 0;
                sub.pause_duration = 0;
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup(env: &Env) -> (SubTrackrContractClient<'_>, Address, Address, Address, Address) {
        let contract_id = env.register_contract(None, SubTrackrContract);
        let client = SubTrackrContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let merchant = Address::generate(env);
        let subscriber = Address::generate(env);
        let token = Address::generate(env);

        env.mock_all_auths();
        client.initialize(&admin);
        client.create_plan(
            &merchant,
            &String::from_str(env, "Basic"),
            &500_i128,
            &token,
            &Interval::Monthly,
        );

        (client, admin, merchant, subscriber, token)
    }

    #[test]
    fn test_create_plan_and_subscribe() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SubTrackrContract);
        let client = SubTrackrContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let token = Address::generate(&env);

        env.mock_all_auths();

        client.initialize(&admin);

        let plan_id = client.create_plan(
            &merchant,
            &String::from_str(&env, "Pro Plan"),
            &1000_i128,
            &token,
            &Interval::Monthly,
        );

        assert_eq!(plan_id, 1);
        assert_eq!(client.get_plan_count(), 1);

        let plan = client.get_plan(&1);
        assert_eq!(plan.price, 1000);
        assert!(plan.active);

        let sub_id = client.subscribe(&subscriber, &1);
        assert_eq!(sub_id, 1);

        let sub = client.get_subscription(&1);
        assert_eq!(sub.status, SubscriptionStatus::Active);
        assert_eq!(sub.plan_id, 1);

        let user_subs = client.get_user_subscriptions(&subscriber);
        assert_eq!(user_subs.len(), 1);
    }

    #[test]
    fn test_cancel_subscription() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        client.subscribe(&subscriber, &1);

        client.cancel_subscription(&subscriber, &1);

        let sub = client.get_subscription(&1);
        assert_eq!(sub.status, SubscriptionStatus::Cancelled);

        let plan = client.get_plan(&1);
        assert_eq!(plan.subscriber_count, 0);
    }

    #[test]
    #[should_panic(expected = "Payment not yet due")]
    fn test_charge_subscription_not_due() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        client.subscribe(&subscriber, &1);

        client.charge_subscription(&1);
    }

    #[test]
    #[should_panic(expected = "Already subscribed to this plan")]
    fn test_double_subscribe() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        client.subscribe(&subscriber, &1);

        client.subscribe(&subscriber, &1);
    }

    #[test]
    fn test_plan_deactivation_existing_subscribers_unaffected() {
        let env = Env::default();
        let (client, _admin, merchant, subscriber, _token) = setup(&env);
        let sub_id = client.subscribe(&subscriber, &1);

        client.deactivate_plan(&merchant, &1);
        let plan = client.get_plan(&1);
        assert!(!plan.active);

        // Existing subscriber can still keep/operate subscription lifecycle.
        client.pause_subscription(&subscriber, &sub_id);
        let paused = client.get_subscription(&sub_id);
        assert_eq!(paused.status, SubscriptionStatus::Paused);
    }

    #[test]
    #[should_panic(expected = "Subscription not active")]
    fn test_charge_paused_subscription() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        client.subscribe(&subscriber, &1);
        client.pause_subscription(&subscriber, &1);

        client.charge_subscription(&1);
    }

    #[test]
    #[should_panic(expected = "Merchant cannot self-subscribe")]
    fn test_merchant_cannot_subscribe() {
        let env = Env::default();
        let (client, _admin, merchant, _subscriber, _token) = setup(&env);

        client.subscribe(&merchant, &1);
    }

    #[test]
    #[should_panic(expected = "Only subscriber can cancel")]
    fn test_non_subscriber_cannot_cancel() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        let attacker = Address::generate(&env);
        client.subscribe(&subscriber, &1);

        client.cancel_subscription(&attacker, &1);
    }

    #[test]
    fn test_pause_and_resume() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        let sub_id = client.subscribe(&subscriber, &1);
        let initial = client.get_subscription(&sub_id);

        client.pause_subscription(&subscriber, &sub_id);
        let paused = client.get_subscription(&sub_id);
        assert_eq!(paused.status, SubscriptionStatus::Paused);

        env.ledger().with_mut(|li| {
            li.timestamp += 86_400;
        });

        client.resume_subscription(&subscriber, &sub_id);
        let resumed = client.get_subscription(&sub_id);
        assert_eq!(resumed.status, SubscriptionStatus::Active);
        assert_eq!(resumed.next_charge_at, env.ledger().timestamp() + Interval::Monthly.seconds());
        assert!(resumed.next_charge_at > initial.next_charge_at);
    }

    #[test]
    #[should_panic(expected = "Pause duration exceeds limit")]
    fn test_pause_by_subscriber_limit_enforced() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        let sub_id = client.subscribe(&subscriber, &1);

        // Max is 30 days (2,592_000s). Try 31 days.
        client.pause_by_subscriber(&subscriber, &sub_id, &2_678_400);
    }

    #[test]
    fn test_auto_resume() {
        let env = Env::default();
        let (client, _admin, _merchant, subscriber, _token) = setup(&env);
        let sub_id = client.subscribe(&subscriber, &1);

        // Pause for 1 day (86,400s)
        client.pause_by_subscriber(&subscriber, &sub_id, &86_400);
        let paused = client.get_subscription(&sub_id);
        assert_eq!(paused.status, SubscriptionStatus::Paused);

        // Fast forward 2 days (172,800s)
        env.ledger().with_mut(|li| {
            li.timestamp += 172_800;
        });

        // get_subscription should now return Active due to auto-resume
        let resumed = client.get_subscription(&sub_id);
        assert_eq!(resumed.status, SubscriptionStatus::Active);
        assert_eq!(resumed.paused_at, 0);
        assert_eq!(resumed.pause_duration, 0);

        // charge_subscription should also work now
        // But we need to make sure next_charge_at is reached
        env.ledger().with_mut(|li| {
            li.timestamp += Interval::Monthly.seconds();
        });
        client.charge_subscription(&sub_id);
        
        let charged = client.get_subscription(&sub_id);
        assert_eq!(charged.total_paid, 500);
    }
}
