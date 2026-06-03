#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};
use subtrackr_types::{
    FraudAction, FraudCase, FraudReport, FraudReviewStatus, MerchantId, RiskScore, RiskSignal,
    RiskSignalKind, SubscriptionId,
};

const HIGH_RISK_THRESHOLD: u32 = 80;
const REVIEW_THRESHOLD: u32 = 50;
const VELOCITY_WINDOW_SECS: u64 = 86_400;
const VELOCITY_LIMIT: u32 = 3;
const MAX_REVIEW_CASES: u32 = 5;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
struct SubscriptionProfile {
    subscription_id: SubscriptionId,
    subscriber: Address,
    merchant_id: MerchantId,
    created_at: u64,
    last_activity_at: u64,
    expected_usage: u32,
    observed_usage: u32,
    chargebacks: u32,
    is_flagged: bool,
    is_blocked: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
enum StorageKey {
    Subscription(SubscriptionId),
    SubscriberSubscriptions(Address),
    MerchantSubscriptions(Address),
    ReviewCase(SubscriptionId),
}

fn push_unique_u64(items: &mut Vec<SubscriptionId>, value: SubscriptionId) {
    let mut i = 0u32;
    while i < items.len() {
        if items.get(i).unwrap() == value {
            return;
        }
        i += 1;
    }
    items.push_back(value);
}

fn push_unique_address(items: &mut Vec<Address>, value: Address) {
    let mut i = 0u32;
    while i < items.len() {
        if items.get(i).unwrap() == value {
            return;
        }
        i += 1;
    }
    items.push_back(value);
}

fn get_subscriptions(env: &Env, subscriber: &Address) -> Vec<SubscriptionId> {
    env.storage()
        .persistent()
        .get::<_, Vec<SubscriptionId>>(&StorageKey::SubscriberSubscriptions(subscriber.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

fn get_merchant_subscriptions(env: &Env, merchant: &Address) -> Vec<SubscriptionId> {
    env.storage()
        .persistent()
        .get::<_, Vec<SubscriptionId>>(&StorageKey::MerchantSubscriptions(merchant.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

fn save_subscriptions(env: &Env, subscriber: &Address, ids: &Vec<SubscriptionId>) {
    env.storage()
        .persistent()
        .set(&StorageKey::SubscriberSubscriptions(subscriber.clone()), &ids.clone());
}

fn save_merchant_subscriptions(env: &Env, merchant: &Address, ids: &Vec<SubscriptionId>) {
    env.storage()
        .persistent()
        .set(&StorageKey::MerchantSubscriptions(merchant.clone()), &ids.clone());
}

fn load_profile(env: &Env, subscription_id: SubscriptionId) -> Option<SubscriptionProfile> {
    env.storage()
        .persistent()
        .get(&StorageKey::Subscription(subscription_id))
}

fn save_profile(env: &Env, profile: &SubscriptionProfile) {
    env.storage()
        .persistent()
        .set(&StorageKey::Subscription(profile.subscription_id), &profile.clone());
}

fn determine_velocity_score(env: &Env, profile: &SubscriptionProfile, ids: &Vec<SubscriptionId>) -> u32 {
    let now = env.ledger().timestamp();
    let mut recent_creations = 0u32;
    let mut i = 0u32;
    while i < ids.len() {
        if let Some(sub_id) = ids.get(i) {
            if let Some(other) = load_profile(env, sub_id) {
                if now.saturating_sub(other.created_at) <= VELOCITY_WINDOW_SECS
                    && other.subscriber == profile.subscriber
                {
                    recent_creations += 1;
                }
            }
        }
        i += 1;
    }

    if recent_creations <= VELOCITY_LIMIT {
        0
    } else {
        ((recent_creations - VELOCITY_LIMIT) * 15).min(40)
    }
}

fn determine_anomaly_score(profile: &SubscriptionProfile) -> u32 {
    if profile.expected_usage == 0 && profile.observed_usage > 0 {
        return 20;
    }

    if profile.expected_usage == 0 {
        return 0;
    }

    if profile.observed_usage >= profile.expected_usage.saturating_mul(3) {
        35
    } else if profile.observed_usage >= profile.expected_usage.saturating_mul(2) {
        25
    } else if profile.observed_usage > profile.expected_usage {
        10
    } else {
        0
    }
}

fn determine_chargeback_score(profile: &SubscriptionProfile) -> u32 {
    match profile.chargebacks {
        0 => 0,
        1 => 30,
        2 => 50,
        _ => 70,
    }
}

fn determine_action(score: u32) -> FraudAction {
    if score >= HIGH_RISK_THRESHOLD {
        FraudAction::Block
    } else if score >= REVIEW_THRESHOLD {
        FraudAction::Flag
    } else {
        FraudAction::Approve
    }
}

fn score_profile(
    env: &Env,
    profile: &SubscriptionProfile,
    ids: &Vec<SubscriptionId>,
) -> RiskScore {
    let now = env.ledger().timestamp();
    let velocity_score = determine_velocity_score(env, profile, ids);
    let anomaly_score = determine_anomaly_score(profile);
    let chargeback_score = determine_chargeback_score(profile);
    let total_score = (velocity_score + anomaly_score + chargeback_score).min(100);

    let mut signals = Vec::new(env);
    if velocity_score > 0 {
        signals.push_back(RiskSignal {
            kind: RiskSignalKind::Velocity,
            score: velocity_score,
            detail: String::from_str(env, "rapid subscription creation"),
            observed_at: now,
        });
    }
    if anomaly_score > 0 {
        signals.push_back(RiskSignal {
            kind: RiskSignalKind::UsageAnomaly,
            score: anomaly_score,
            detail: String::from_str(env, "usage pattern deviates from baseline"),
            observed_at: now,
        });
    }
    if chargeback_score > 0 {
        signals.push_back(RiskSignal {
            kind: RiskSignalKind::Chargeback,
            score: chargeback_score,
            detail: String::from_str(env, "chargeback history predicts dispute risk"),
            observed_at: now,
        });
    }

    let reason = if chargeback_score >= anomaly_score && chargeback_score >= velocity_score {
        String::from_str(env, "chargeback risk dominates")
    } else if velocity_score >= anomaly_score {
        String::from_str(env, "velocity risk is elevated")
    } else {
        String::from_str(env, "usage anomaly detected")
    };

    RiskScore {
        subscriber: profile.subscriber.clone(),
        subscription_id: profile.subscription_id,
        merchant_id: profile.merchant_id.clone(),
        total_score,
        velocity_score,
        anomaly_score,
        chargeback_score,
        action: determine_action(total_score),
        reason,
        assessed_at: now,
        signals,
    }
}

fn persist_case(env: &Env, score: &RiskScore, status: FraudReviewStatus) -> FraudCase {
    let case = FraudCase {
        case_id: score.subscription_id,
        subscription_id: score.subscription_id,
        subscriber: score.subscriber.clone(),
        merchant_id: score.merchant_id.clone(),
        risk_score: score.total_score,
        action: score.action.clone(),
        status,
        reason: score.reason.clone(),
        created_at: score.assessed_at,
        updated_at: score.assessed_at,
    };

    env.storage()
        .persistent()
        .set(&StorageKey::ReviewCase(score.subscription_id), &case.clone());
    case
}

fn update_profile_action(env: &Env, subscription_id: SubscriptionId, score: &RiskScore) {
    if let Some(mut profile) = load_profile(env, subscription_id) {
        profile.is_flagged = matches!(score.action, FraudAction::Flag | FraudAction::Block);
        profile.is_blocked = matches!(score.action, FraudAction::Block);
        profile.last_activity_at = score.assessed_at;
        save_profile(env, &profile);
    }
}

fn review_case_for_subscription(env: &Env, subscription_id: SubscriptionId) -> Option<FraudCase> {
    env.storage()
        .persistent()
        .get(&StorageKey::ReviewCase(subscription_id))
}

#[contract]
pub struct SubTrackrFraud;

#[contractimpl]
impl SubTrackrFraud {
    pub fn register_subscription(
        env: Env,
        subscriber: Address,
        merchant_id: Address,
        subscription_id: SubscriptionId,
        created_at: u64,
    ) {
        subscriber.require_auth();

        let profile = SubscriptionProfile {
            subscription_id,
            subscriber: subscriber.clone(),
            merchant_id: merchant_id.clone(),
            created_at,
            last_activity_at: created_at,
            expected_usage: 1,
            observed_usage: 1,
            chargebacks: 0,
            is_flagged: false,
            is_blocked: false,
        };

        save_profile(&env, &profile);

        let mut subscriber_ids = get_subscriptions(&env, &subscriber);
        push_unique_u64(&mut subscriber_ids, subscription_id);
        save_subscriptions(&env, &subscriber, &subscriber_ids);

        let mut merchant_ids = get_merchant_subscriptions(&env, &merchant_id);
        push_unique_u64(&mut merchant_ids, subscription_id);
        save_merchant_subscriptions(&env, &merchant_id, &merchant_ids);
    }

    pub fn record_usage_pattern(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
        expected_usage: u32,
        observed_usage: u32,
    ) {
        subscriber.require_auth();

        if let Some(mut profile) = load_profile(&env, subscription_id) {
            profile.expected_usage = expected_usage;
            profile.observed_usage = observed_usage;
            profile.last_activity_at = env.ledger().timestamp();
            save_profile(&env, &profile);
        }
    }

    pub fn record_chargeback(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
    ) {
        subscriber.require_auth();

        if let Some(mut profile) = load_profile(&env, subscription_id) {
            profile.chargebacks = profile.chargebacks.saturating_add(1);
            profile.last_activity_at = env.ledger().timestamp();
            save_profile(&env, &profile);
        }
    }

    pub fn assess_risk(env: Env, subscriber: Address) -> RiskScore {
        let ids = get_subscriptions(&env, &subscriber);
        if ids.is_empty() {
            return RiskScore {
                subscriber: subscriber.clone(),
                subscription_id: 0,
                merchant_id: subscriber.clone(),
                total_score: 0,
                velocity_score: 0,
                anomaly_score: 0,
                chargeback_score: 0,
                action: FraudAction::Approve,
                reason: String::from_str(&env, "no subscription history"),
                assessed_at: env.ledger().timestamp(),
                signals: Vec::new(&env),
            };
        }

        let mut highest = score_profile(
            &env,
            &load_profile(&env, ids.get(0).unwrap()).unwrap(),
            &ids,
        );

        let mut i = 1u32;
        while i < ids.len() {
            if let Some(profile) = load_profile(&env, ids.get(i).unwrap()) {
                let next = score_profile(&env, &profile, &ids);
                if next.total_score > highest.total_score {
                    highest = next;
                }
            }
            i += 1;
        }

        highest
    }

    pub fn flag_subscription(env: Env, subscription_id: SubscriptionId) {
        if let Some(profile) = load_profile(&env, subscription_id) {
            let ids = get_subscriptions(&env, &profile.subscriber);
            let score = score_profile(&env, &profile, &ids);
            let status = if matches!(score.action, FraudAction::Block) {
                FraudReviewStatus::Escalated
            } else {
                FraudReviewStatus::Pending
            };
            let case = persist_case(&env, &score, status);
            update_profile_action(&env, subscription_id, &score);
            env.events().publish(
                (String::from_str(&env, "fraud_case_opened"), score.subscription_id),
                (case.risk_score, case.action.clone()),
            );
        } else {
            panic!("Subscription not found");
        }
    }

    pub fn resolve_case(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
        approved: bool,
    ) {
        subscriber.require_auth();
        if let Some(mut case) = review_case_for_subscription(&env, subscription_id) {
            case.status = FraudReviewStatus::Reviewed;
            case.updated_at = env.ledger().timestamp();
            case.action = if approved {
                FraudAction::Approve
            } else {
                FraudAction::Block
            };
            env.storage()
                .persistent()
                .set(&StorageKey::ReviewCase(subscription_id), &case.clone());
        }
    }

    pub fn get_fraud_report(env: Env, merchant_id: Address) -> FraudReport {
        let ids = get_merchant_subscriptions(&env, &merchant_id);
        let mut total_risk = 0u32;
        let mut flagged = 0u32;
        let mut blocked = 0u32;
        let mut manual_review = 0u32;
        let mut velocity_alerts = 0u32;
        let mut anomaly_alerts = 0u32;
        let mut chargeback_predictions = 0u32;
        let mut high_risk_subscribers: Vec<Address> = Vec::new(&env);
        let mut recent_cases: Vec<FraudCase> = Vec::new(&env);

        let mut i = 0u32;
        while i < ids.len() {
            if let Some(profile) = load_profile(&env, ids.get(i).unwrap()) {
                let subscriber_ids = get_subscriptions(&env, &profile.subscriber);
                let score = score_profile(&env, &profile, &subscriber_ids);
                total_risk += score.total_score;

                if matches!(score.action, FraudAction::Flag | FraudAction::Block) {
                    flagged += 1;
                }
                if matches!(score.action, FraudAction::Block) {
                    blocked += 1;
                }
                if score.total_score >= REVIEW_THRESHOLD {
                    manual_review += 1;
                }
                if score.velocity_score > 0 {
                    velocity_alerts += 1;
                }
                if score.anomaly_score > 0 {
                    anomaly_alerts += 1;
                }
                if score.chargeback_score > 0 {
                    chargeback_predictions += 1;
                }
                if score.total_score >= REVIEW_THRESHOLD {
                    push_unique_address(&mut high_risk_subscribers, score.subscriber.clone());
                }

                if let Some(case) = review_case_for_subscription(&env, score.subscription_id) {
                    recent_cases.push_back(case);
                } else if score.total_score >= REVIEW_THRESHOLD {
                    recent_cases.push_back(persist_case(&env, &score, FraudReviewStatus::Pending));
                }
            }
            i += 1;
        }

        let average_risk = if ids.is_empty() {
            0
        } else {
            total_risk / ids.len()
        };

        let mut trimmed_cases = Vec::new(&env);
        let mut idx = recent_cases.len();
        let mut copied = 0u32;
        while idx > 0 && copied < MAX_REVIEW_CASES {
            idx -= 1;
            if let Some(case) = recent_cases.get(idx) {
                trimmed_cases.push_back(case);
                copied += 1;
            }
        }

        FraudReport {
            merchant_id,
            total_subscriptions: ids.len(),
            flagged_subscriptions: flagged,
            blocked_subscriptions: blocked,
            manual_review_count: manual_review,
            average_risk,
            velocity_alerts,
            anomaly_alerts,
            chargeback_predictions,
            high_risk_subscribers: high_risk_subscribers.len(),
            recent_cases: trimmed_cases,
        }
    }
}
