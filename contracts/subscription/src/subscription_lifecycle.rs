/// Subscription Lifecycle Module
///
/// Handles subscription CRUD operations: subscribe, cancel, pause, resume.
use soroban_sdk::{Address, Env, String, Vec};

use crate::enforce_rate_limit;
use crate::get_admin;
use crate::storage_instance_get;
use crate::storage_instance_set;
use crate::storage_persistent_get;
use crate::storage_persistent_remove;
use crate::storage_persistent_set;
use subtrackr_types::{Plan, StorageKey, Subscription, SubscriptionStatus};

use super::plan;

pub const MAX_PAUSE_DURATION: u64 = 2_592_000;

pub fn subscribe(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
) -> u64 {
    if *subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, subscriber, "subscribe");
    }
    subscriber.require_auth();

    let mut plan_data: Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(plan_id)).expect("Plan not found");
    assert!(plan_data.active, "Plan is not active");
    assert!(plan_data.merchant != *subscriber, "Merchant cannot self-subscribe");

    if let Some(existing_id) = get_user_plan_index(env, storage, subscriber, plan_id) {
        let existing_sub: Subscription =
            storage_persistent_get(env, storage, StorageKey::Subscription(existing_id))
                .expect("Subscription not found");
        if existing_sub.status != SubscriptionStatus::Cancelled {
            panic!("Already subscribed to this plan");
        }
    }

    let mut sub_count: u64 =
        storage_instance_get(env, storage, StorageKey::SubscriptionCount).unwrap_or(0);
    sub_count += 1;

    let now = env.ledger().timestamp();

    // Check for trial configuration
    let trial_opt: Option<subtrackr_types::TrialConfig> = storage_persistent_get(env, storage, StorageKey::PlanTrial(plan_id));
    let (status, next_charge_at) = if let Some(trial) = trial_opt {
        if trial.has_trial {
            (SubscriptionStatus::Trialing, now + trial.duration_seconds)
        } else {
            (SubscriptionStatus::Active, now + plan_data.interval.seconds())
        }
    } else {
        (SubscriptionStatus::Active, now + plan_data.interval.seconds())
    };

    let subscription = Subscription {
        id: sub_count,
        plan_id,
        subscriber: subscriber.clone(),
        status,
        started_at: now,
        last_charged_at: now,
        next_charge_at,
        total_paid: 0,
        total_gas_spent: 0,
        charge_count: 0,
        paused_at: 0,
        pause_duration: 0,
        refund_requested_amount: 0,
    };

    storage_persistent_set(env, storage, StorageKey::Subscription(sub_count), subscription);
    storage_instance_set(env, storage, StorageKey::SubscriptionCount, sub_count);

    let mut user_subs: Vec<u64> = storage_persistent_get(
        env, storage, StorageKey::UserSubscriptions(subscriber.clone()),
    ).unwrap_or(Vec::new(env));
    user_subs.push_back(sub_count);
    storage_persistent_set(
        env, storage, StorageKey::UserSubscriptions(subscriber.clone()), user_subs,
    );

    set_user_plan_index(env, storage, subscriber, plan_id, sub_count);

    plan_data.subscriber_count += 1;
    storage_persistent_set(env, storage, StorageKey::Plan(plan_id), plan_data);

    env.events().publish(
        (String::from_str(env, "subscribed"), subscriber.clone()),
        (sub_count, plan_id),
    );

    sub_count
}

pub fn cancel_subscription(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    subscription_id: u64,
) {
    if *subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, subscriber, "cancel_subscription");
    }
    subscriber.require_auth();

    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    assert!(sub.subscriber == *subscriber, "Only subscriber can cancel");
    assert!(
        sub.status == SubscriptionStatus::Active || sub.status == SubscriptionStatus::Paused,
        "Subscription not active"
    );

    sub.status = SubscriptionStatus::Cancelled;
    storage_persistent_set(env, storage, StorageKey::Subscription(subscription_id), sub.clone());

    remove_user_plan_index(env, storage, subscriber, sub.plan_id);

    let mut plan_data: Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(sub.plan_id)).expect("Plan not found");
    if plan_data.subscriber_count > 0 {
        plan_data.subscriber_count -= 1;
    }
    storage_persistent_set(env, storage, StorageKey::Plan(sub.plan_id), plan_data);

    env.events().publish(
        (String::from_str(env, "subscription_cancelled"), subscriber.clone()),
        subscription_id,
    );
}

pub fn pause_subscription(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    subscription_id: u64,
) {
    pause_by_subscriber(env, storage, subscriber, subscription_id, MAX_PAUSE_DURATION);
}

pub fn pause_by_subscriber(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    subscription_id: u64,
    duration: u64,
) {
    if *subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, subscriber, "pause_by_subscriber");
    }
    subscriber.require_auth();

    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    assert!(sub.subscriber == *subscriber, "Only subscriber can pause");
    assert!(sub.status == SubscriptionStatus::Active, "Only active subscriptions can be paused");
    assert!(duration <= MAX_PAUSE_DURATION, "Pause duration exceeds limit");

    sub.status = SubscriptionStatus::Paused;
    sub.paused_at = env.ledger().timestamp();
    sub.pause_duration = duration;

    storage_persistent_set(env, storage, StorageKey::Subscription(subscription_id), sub.clone());

    env.events().publish(
        (String::from_str(env, "subscription_paused"), subscriber.clone()),
        (subscription_id, sub.paused_at, duration),
    );
}

pub fn resume_subscription(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    subscription_id: u64,
) {
    if *subscriber != get_admin(env, storage) {
        enforce_rate_limit(env, storage, subscriber, "resume_subscription");
    }
    subscriber.require_auth();

    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");

    assert!(sub.subscriber == *subscriber, "Only subscriber can resume");
    assert!(
        sub.status == SubscriptionStatus::Paused || check_and_resume(env, &mut sub),
        "Only paused subscriptions can be resumed"
    );

    let now = env.ledger().timestamp();
    let plan_data: Plan =
        storage_persistent_get(env, storage, StorageKey::Plan(sub.plan_id)).expect("Plan not found");

    sub.status = SubscriptionStatus::Active;
    sub.next_charge_at = now + plan_data.interval.seconds();
    sub.paused_at = 0;
    sub.pause_duration = 0;

    storage_persistent_set(env, storage, StorageKey::Subscription(subscription_id), sub);

    env.events().publish(
        (String::from_str(env, "subscription_resumed"), subscriber.clone()),
        subscription_id,
    );
}

pub fn get_subscription(env: &Env, storage: &Address, subscription_id: u64) -> Subscription {
    let mut sub: Subscription =
        storage_persistent_get(env, storage, StorageKey::Subscription(subscription_id))
            .expect("Subscription not found");
    check_and_resume(env, &mut sub);
    sub
}

pub fn get_user_subscriptions(env: &Env, storage: &Address, subscriber: &Address) -> Vec<u64> {
    storage_persistent_get(env, storage, StorageKey::UserSubscriptions(subscriber.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn get_subscription_count(env: &Env, storage: &Address) -> u64 {
    storage_instance_get(env, storage, StorageKey::SubscriptionCount).unwrap_or(0)
}

// ── Internal Helpers ──

pub fn check_and_resume(env: &Env, sub: &mut Subscription) -> bool {
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

fn set_user_plan_index(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
    subscription_id: u64,
) {
    storage_persistent_set(
        env, storage, StorageKey::UserPlanIndex(subscriber.clone(), plan_id), subscription_id,
    );
}

fn remove_user_plan_index(env: &Env, storage: &Address, subscriber: &Address, plan_id: u64) {
    storage_persistent_remove(
        env, storage, StorageKey::UserPlanIndex(subscriber.clone(), plan_id),
    );
}

fn get_user_plan_index(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    plan_id: u64,
) -> Option<u64> {
    storage_persistent_get(env, storage, StorageKey::UserPlanIndex(subscriber.clone(), plan_id))
}
