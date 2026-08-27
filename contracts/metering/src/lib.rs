#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// Metered plan definition
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MeteredPlan {
    pub id: u64,
    pub merchant: Address,
    pub name: String,
    pub metric_name: String,
    pub base_price: i128,
    pub unit_rate: i128,
    pub included_units: u64,
    pub billing_interval_secs: u64,
    pub active: bool,
    pub created_at: u64,
}

/// Usage state for a specific subscription
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionUsage {
    pub subscription_id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    pub cumulative_usage: u64,
    pub period_usage: u64,
    pub usage_limit: u64,
    pub accrued_fee: i128,
    pub last_updated: u64,
    pub period_start: u64,
}

/// Event representing a recorded usage event
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UsageEvent {
    pub subscription_id: u64,
    pub quantity: u64,
    pub reporter: Address,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    MeteredPlan(u64),
    MeteredPlanCount,
    SubscriptionUsage(u64),
    UsageLogs(u64),
    RateLimit(String),
    LastCall(Address, String),
}

#[contract]
pub struct SubTrackrMeteringContract;

#[contractimpl]
impl SubTrackrMeteringContract {
    /// Initialize contract with admin address
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MeteredPlanCount, &0u64);
    }

    /// Admin set rate limit in seconds for a function
    pub fn set_rate_limit(env: Env, function: String, min_interval_secs: u64) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::RateLimit(function), &min_interval_secs);
    }

    /// Admin remove rate limit
    pub fn remove_rate_limit(env: Env, function: String) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .remove(&DataKey::RateLimit(function));
    }

    /// Create a metered billing plan
    pub fn create_metered_plan(
        env: Env,
        merchant: Address,
        name: String,
        metric_name: String,
        base_price: i128,
        unit_rate: i128,
        included_units: u64,
        billing_interval_secs: u64,
    ) -> u64 {
        if merchant != Self::get_admin(&env) {
            Self::enforce_rate_limit(&env, &merchant, "create_metered_plan");
        }
        merchant.require_auth();
        assert!(base_price >= 0, "Base price cannot be negative");
        assert!(unit_rate >= 0, "Unit rate cannot be negative");
        assert!(billing_interval_secs > 0, "Billing interval must be positive");

        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MeteredPlanCount)
            .unwrap_or(0);
        count += 1;

        let plan = MeteredPlan {
            id: count,
            merchant,
            name,
            metric_name,
            base_price,
            unit_rate,
            included_units,
            billing_interval_secs,
            active: true,
            created_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::MeteredPlan(count), &plan);
        env.storage().instance().set(&DataKey::MeteredPlanCount, &count);

        count
    }

    /// Get a metered plan details
    pub fn get_metered_plan(env: Env, plan_id: u64) -> MeteredPlan {
        env.storage()
            .persistent()
            .get(&DataKey::MeteredPlan(plan_id))
            .expect("Metered plan not found")
    }

    /// Register/Initialize usage tracking for a subscription
    pub fn create_subscription_usage(
        env: Env,
        subscriber: Address,
        subscription_id: u64,
        plan_id: u64,
        usage_limit: u64,
    ) {
        subscriber.require_auth();
        let plan = Self::get_metered_plan(env.clone(), plan_id);
        assert!(plan.active, "Metered plan is not active");

        let now = env.ledger().timestamp();
        let usage = SubscriptionUsage {
            subscription_id,
            plan_id,
            subscriber: subscriber.clone(),
            cumulative_usage: 0,
            period_usage: 0,
            usage_limit,
            accrued_fee: plan.base_price,
            last_updated: now,
            period_start: now,
        };

        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionUsage(subscription_id), &usage);
    }

    /// Record usage for a subscription
    pub fn record_usage(
        env: Env,
        reporter: Address,
        subscription_id: u64,
        quantity: u64,
    ) -> u64 {
        reporter.require_auth();
        assert!(quantity > 0, "Quantity must be greater than zero");

        let mut usage: SubscriptionUsage = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionUsage(subscription_id))
            .expect("Subscription usage record not found");

        let plan = Self::get_metered_plan(env.clone(), usage.plan_id);
        assert!(plan.active, "Plan is inactive");

        // Verify reporter is subscriber, merchant, or admin
        assert!(
            reporter == usage.subscriber || reporter == plan.merchant || reporter == Self::get_admin(&env),
            "Unauthorized reporter"
        );

        let new_period_usage = usage
            .period_usage
            .checked_add(quantity)
            .expect("Period usage overflow");

        if usage.usage_limit > 0 {
            assert!(
                new_period_usage <= usage.usage_limit,
                "Usage limit exceeded for billing period"
            );
        }

        usage.period_usage = new_period_usage;
        usage.cumulative_usage = usage
            .cumulative_usage
            .checked_add(quantity)
            .expect("Cumulative usage overflow");
        usage.last_updated = env.ledger().timestamp();

        // Recalculate accrued fee
        let excess_units = if usage.period_usage > plan.included_units {
            (usage.period_usage - plan.included_units) as i128
        } else {
            0
        };

        usage.accrued_fee = plan.base_price + excess_units * plan.unit_rate;

        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionUsage(subscription_id), &usage);

        // Store usage event in history log
        let mut logs: Vec<UsageEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::UsageLogs(subscription_id))
            .unwrap_or(Vec::new(&env));

        logs.push_back(UsageEvent {
            subscription_id,
            quantity,
            reporter,
            timestamp: env.ledger().timestamp(),
        });

        env.storage()
            .persistent()
            .set(&DataKey::UsageLogs(subscription_id), &logs);

        usage.period_usage
    }

    /// Update usage cap / hard limit for a subscription
    pub fn set_usage_limit(
        env: Env,
        subscriber: Address,
        subscription_id: u64,
        max_units: u64,
    ) {
        subscriber.require_auth();
        let mut usage: SubscriptionUsage = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionUsage(subscription_id))
            .expect("Subscription usage record not found");

        assert!(
            subscriber == usage.subscriber || subscriber == Self::get_admin(&env),
            "Only subscriber or admin can set limit"
        );

        usage.usage_limit = max_units;
        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionUsage(subscription_id), &usage);
    }

    /// Calculate accrued total bill (base price + excess metered usage)
    pub fn calculate_accrued_bill(env: Env, subscription_id: u64) -> i128 {
        let usage: SubscriptionUsage = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionUsage(subscription_id))
            .expect("Subscription usage record not found");

        let plan = Self::get_metered_plan(env, usage.plan_id);

        let excess_units = if usage.period_usage > plan.included_units {
            (usage.period_usage - plan.included_units) as i128
        } else {
            0
        };

        plan.base_price + excess_units * plan.unit_rate
    }

    /// Reset billing period counter when cycle renews
    pub fn reset_billing_period(env: Env, caller: Address, subscription_id: u64) {
        caller.require_auth();
        let mut usage: SubscriptionUsage = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionUsage(subscription_id))
            .expect("Subscription usage record not found");

        let plan = Self::get_metered_plan(env.clone(), usage.plan_id);
        assert!(
            caller == usage.subscriber || caller == plan.merchant || caller == Self::get_admin(&env),
            "Unauthorized caller"
        );

        let now = env.ledger().timestamp();
        usage.period_usage = 0;
        usage.accrued_fee = plan.base_price;
        usage.period_start = now;
        usage.last_updated = now;

        env.storage()
            .persistent()
            .set(&DataKey::SubscriptionUsage(subscription_id), &usage);
    }

    /// Get current subscription usage struct
    pub fn get_usage(env: Env, subscription_id: u64) -> SubscriptionUsage {
        env.storage()
            .persistent()
            .get(&DataKey::SubscriptionUsage(subscription_id))
            .expect("Subscription usage record not found")
    }

    /// Get usage event history log for subscription
    pub fn get_usage_history(env: Env, subscription_id: u64) -> Vec<UsageEvent> {
        env.storage()
            .persistent()
            .get(&DataKey::UsageLogs(subscription_id))
            .unwrap_or(Vec::new(&env))
    }

    // ── Helper Functions ──

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    fn enforce_rate_limit(env: &Env, caller: &Address, function: &str) {
        let function_str = String::from_str(env, function);
        if let Some(min_interval) = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::RateLimit(function_str.clone()))
        {
            let last_call: u64 = env
                .storage()
                .instance()
                .get(&DataKey::LastCall(caller.clone(), function_str.clone()))
                .unwrap_or(0);
            let now = env.ledger().timestamp();
            if last_call > 0 {
                assert!(
                    now >= last_call + min_interval,
                    "Rate limit exceeded for function"
                );
            }
            env.storage().instance().set(
                &DataKey::LastCall(caller.clone(), function_str),
                &now,
            );
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{symbol_short, Address, Env, String};

    fn setup_test() -> (Env, Address, Address, Address, SubTrackrMeteringContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let subscriber = Address::generate(&env);

        let contract_id = env.register_contract(None, SubTrackrMeteringContract);
        let client = SubTrackrMeteringContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        (env, admin, merchant, subscriber, client)
    }

    #[test]
    fn test_create_metered_plan_and_usage() {
        let (_env, _admin, merchant, subscriber, client) = setup_test();

        let name = String::from_str(&_env, "API Basic Plan");
        let metric = String::from_str(&_env, "API Calls");

        let plan_id = client.create_metered_plan(
            &merchant,
            &name,
            &metric,
            &1000, // base price
            &10,   // unit rate
            &100,  // included units
            &86400,// 1 day interval
        );

        assert_eq!(plan_id, 1);

        let plan = client.get_metered_plan(&plan_id);
        assert_eq!(plan.base_price, 1000);
        assert_eq!(plan.unit_rate, 10);
        assert_eq!(plan.included_units, 100);

        client.create_subscription_usage(&subscriber, &101, &plan_id, &500);

        let usage = client.get_usage(&101);
        assert_eq!(usage.subscription_id, 101);
        assert_eq!(usage.period_usage, 0);
        assert_eq!(usage.accrued_fee, 1000);
        assert_eq!(usage.usage_limit, 500);
    }

    #[test]
    fn test_record_usage_within_included_units() {
        let (_env, _admin, merchant, subscriber, client) = setup_test();

        let name = String::from_str(&_env, "API Plan");
        let metric = String::from_str(&_env, "API Calls");

        let plan_id = client.create_metered_plan(&merchant, &name, &metric, &1000, &5, &100, &86400);
        client.create_subscription_usage(&subscriber, &201, &plan_id, &1000);

        client.record_usage(&subscriber, &201, &50);

        let usage = client.get_usage(&201);
        assert_eq!(usage.period_usage, 50);
        assert_eq!(usage.cumulative_usage, 50);
        assert_eq!(usage.accrued_fee, 1000); // within 100 included units

        let bill = client.calculate_accrued_bill(&201);
        assert_eq!(bill, 1000);
    }

    #[test]
    fn test_record_usage_exceeding_included_units() {
        let (_env, _admin, merchant, subscriber, client) = setup_test();

        let name = String::from_str(&_env, "Storage Plan");
        let metric = String::from_str(&_env, "GB");

        let plan_id = client.create_metered_plan(&merchant, &name, &metric, &500, &20, &50, &86400);
        client.create_subscription_usage(&subscriber, &301, &plan_id, &200);

        // Record 80 units -> 30 excess units * 20 = 600 extra + 500 base = 1100 total
        client.record_usage(&subscriber, &301, &80);

        let usage = client.get_usage(&301);
        assert_eq!(usage.period_usage, 80);
        assert_eq!(usage.accrued_fee, 1100);

        let bill = client.calculate_accrued_bill(&301);
        assert_eq!(bill, 1100);

        let history = client.get_usage_history(&301);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().quantity, 80);
    }

    #[test]
    #[should_panic(expected = "Usage limit exceeded for billing period")]
    fn test_usage_limit_enforcement() {
        let (_env, _admin, merchant, subscriber, client) = setup_test();

        let name = String::from_str(&_env, "Compute Plan");
        let metric = String::from_str(&_env, "Minutes");

        let plan_id = client.create_metered_plan(&merchant, &name, &metric, &100, &2, &10, &86400);
        client.create_subscription_usage(&subscriber, &401, &plan_id, &50); // limit is 50

        client.record_usage(&subscriber, &401, &60); // should panic
    }

    #[test]
    fn test_set_usage_limit_and_period_reset() {
        let (env, _admin, merchant, subscriber, client) = setup_test();

        let name = String::from_str(&_env, "Data Plan");
        let metric = String::from_str(&_env, "Data MB");

        let plan_id = client.create_metered_plan(&merchant, &name, &metric, &200, &1, &0, &86400);
        client.create_subscription_usage(&subscriber, &501, &plan_id, &100);

        client.set_usage_limit(&subscriber, &501, &300);
        let usage = client.get_usage(&501);
        assert_eq!(usage.usage_limit, 300);

        client.record_usage(&subscriber, &501, &150);
        assert_eq!(client.get_usage(&501).period_usage, 150);

        env.ledger().set_timestamp(env.ledger().timestamp() + 86400);

        client.reset_billing_period(&subscriber, &501);
        let reset_usage = client.get_usage(&501);
        assert_eq!(reset_usage.period_usage, 0);
        assert_eq!(reset_usage.cumulative_usage, 150);
        assert_eq!(reset_usage.accrued_fee, 200);
    }

    #[test]
    #[should_panic(expected = "Unauthorized reporter")]
    fn test_unauthorized_reporter() {
        let (env, _admin, merchant, subscriber, client) = setup_test();
        let stranger = Address::generate(&env);

        let name = String::from_str(&env, "Plan");
        let metric = String::from_str(&env, "Unit");
        let plan_id = client.create_metered_plan(&merchant, &name, &metric, &100, &1, &0, &86400);
        client.create_subscription_usage(&subscriber, &601, &plan_id, &100);

        client.record_usage(&stranger, &601, &10);
    }
}
