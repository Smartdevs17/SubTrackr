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
    home_country: Option<String>,
    current_country: Option<String>,
    device_fingerprint: Option<String>,
    trusted_device_fingerprint: Option<String>,
    false_positive_count: u32,
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
    env.storage().persistent().set(
        &StorageKey::SubscriberSubscriptions(subscriber.clone()),
        &ids.clone(),
    );
}

fn save_merchant_subscriptions(env: &Env, merchant: &Address, ids: &Vec<SubscriptionId>) {
    env.storage().persistent().set(
        &StorageKey::MerchantSubscriptions(merchant.clone()),
        &ids.clone(),
    );
}

fn load_profile(env: &Env, subscription_id: SubscriptionId) -> Option<SubscriptionProfile> {
    env.storage()
        .persistent()
        .get(&StorageKey::Subscription(subscription_id))
}

fn save_profile(env: &Env, profile: &SubscriptionProfile) {
    env.storage().persistent().set(
        &StorageKey::Subscription(profile.subscription_id),
        &profile.clone(),
    );
}

fn determine_velocity_score(
    env: &Env,
    profile: &SubscriptionProfile,
    ids: &Vec<SubscriptionId>,
) -> u32 {
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

fn determine_geolocation_score(profile: &SubscriptionProfile) -> u32 {
    match (&profile.home_country, &profile.current_country) {
        (Some(home), Some(current)) if home != current => 24,
        _ => 0,
    }
}

fn determine_device_score(profile: &SubscriptionProfile) -> u32 {
    match (
        &profile.device_fingerprint,
        &profile.trusted_device_fingerprint,
    ) {
        (Some(current), Some(trusted)) if current != trusted => 20,
        _ => 0,
    }
}

fn determine_pattern_shift_score(
    profile: &SubscriptionProfile,
    geo_score: u32,
    device_score: u32,
) -> u32 {
    if profile.observed_usage >= profile.expected_usage.saturating_mul(2)
        && (geo_score > 0 || device_score > 0)
    {
        16
    } else if profile.observed_usage > profile.expected_usage && profile.chargebacks > 0 {
        12
    } else {
        0
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

fn build_evidence(
    env: &Env,
    profile: &SubscriptionProfile,
    geo_score: u32,
    device_score: u32,
) -> Vec<subtrackr_types::FraudEvidence> {
    let now = env.ledger().timestamp();
    let mut evidence = Vec::new(env);
    evidence.push_back(subtrackr_types::FraudEvidence {
        label: String::from_str(env, "payment profile"),
        value: String::from_str(env, "subscription payment reviewed"),
        source: String::from_str(env, "payment"),
        captured_at: now,
        confidence: 88,
    });

    if geo_score > 0 {
        let current = profile
            .current_country
            .clone()
            .unwrap_or_else(|| String::from_str(env, "unknown"));
        evidence.push_back(subtrackr_types::FraudEvidence {
            label: String::from_str(env, "location drift"),
            value: current,
            source: String::from_str(env, "location"),
            captured_at: now,
            confidence: 92,
        });
    }

    if device_score > 0 {
        let current = profile
            .device_fingerprint
            .clone()
            .unwrap_or_else(|| String::from_str(env, "unknown"));
        let trusted = profile
            .trusted_device_fingerprint
            .clone()
            .unwrap_or_else(|| String::from_str(env, "unknown"));
        evidence.push_back(subtrackr_types::FraudEvidence {
            label: String::from_str(env, "device mismatch"),
            value: current,
            source: String::from_str(env, "device"),
            captured_at: now,
            confidence: 87,
        });
    }

    evidence
}

fn score_profile(env: &Env, profile: &SubscriptionProfile, ids: &Vec<SubscriptionId>) -> RiskScore {
    let now = env.ledger().timestamp();
    let velocity_score = determine_velocity_score(env, profile, ids);
    let anomaly_score = determine_anomaly_score(profile);
    let chargeback_score = determine_chargeback_score(profile);
    let geolocation_score = determine_geolocation_score(profile);
    let device_mismatch_score = determine_device_score(profile);
    let pattern_shift_score =
        determine_pattern_shift_score(profile, geolocation_score, device_mismatch_score);
    let false_positive_penalty = (profile.false_positive_count * 20).min(60);
    let total_score = (velocity_score
        + anomaly_score
        + chargeback_score
        + geolocation_score
        + device_mismatch_score
        + pattern_shift_score)
        .saturating_sub(false_positive_penalty)
        .min(100);

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
    if geolocation_score > 0 {
        signals.push_back(RiskSignal {
            kind: RiskSignalKind::GeolocationAnomaly,
            score: geolocation_score,
            detail: String::from_str(env, "current location differs from the usual profile"),
            observed_at: now,
        });
    }
    if device_mismatch_score > 0 {
        signals.push_back(RiskSignal {
            kind: RiskSignalKind::DeviceMismatch,
            score: device_mismatch_score,
            detail: String::from_str(env, "device fingerprint does not match the trusted profile"),
            observed_at: now,
        });
    }
    if pattern_shift_score > 0 {
        signals.push_back(RiskSignal {
            kind: RiskSignalKind::PatternShift,
            score: pattern_shift_score,
            detail: String::from_str(env, "usage patterns shifted alongside fraud indicators"),
            observed_at: now,
        });
    }

    let reason = if geolocation_score >= chargeback_score
        && geolocation_score >= anomaly_score
        && geolocation_score >= velocity_score
    {
        String::from_str(env, "geolocation anomaly is the dominant signal")
    } else if device_mismatch_score >= chargeback_score && device_mismatch_score >= anomaly_score {
        String::from_str(env, "device mismatch is the dominant signal")
    } else if chargeback_score >= anomaly_score && chargeback_score >= velocity_score {
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
        device_mismatch_score,
        geolocation_score,
        pattern_shift_score,
        action: determine_action(total_score),
        reason,
        assessed_at: now,
        signals,
        evidence: build_evidence(env, profile, geolocation_score, device_mismatch_score),
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
        evidence: score.evidence.clone(),
        reviewed_at: score.assessed_at,
    };

    env.storage().persistent().set(
        &StorageKey::ReviewCase(score.subscription_id),
        &case.clone(),
    );
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
            home_country: Option::None,
            current_country: Option::None,
            device_fingerprint: Option::None,
            trusted_device_fingerprint: Option::None,
            false_positive_count: 0,
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

    pub fn record_chargeback(env: Env, subscriber: Address, subscription_id: SubscriptionId) {
        subscriber.require_auth();

        if let Some(mut profile) = load_profile(&env, subscription_id) {
            profile.chargebacks = profile.chargebacks.saturating_add(1);
            profile.last_activity_at = env.ledger().timestamp();
            save_profile(&env, &profile);
        }
    }

    pub fn record_location_profile(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
        home_country: String,
        current_country: String,
    ) {
        subscriber.require_auth();

        if let Some(mut profile) = load_profile(&env, subscription_id) {
            profile.home_country = Option::Some(home_country);
            profile.current_country = Option::Some(current_country);
            profile.last_activity_at = env.ledger().timestamp();
            save_profile(&env, &profile);
        }
    }

    pub fn record_device_profile(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
        device_fingerprint: String,
        trusted_device_fingerprint: String,
    ) {
        subscriber.require_auth();

        if let Some(mut profile) = load_profile(&env, subscription_id) {
            profile.device_fingerprint = Option::Some(device_fingerprint);
            profile.trusted_device_fingerprint = Option::Some(trusted_device_fingerprint);
            profile.last_activity_at = env.ledger().timestamp();
            save_profile(&env, &profile);
        }
    }

    pub fn assess_risk(env: Env, subscriber: Address) -> RiskScore {
        let ids = get_subscriptions(&env, &subscriber);
        if ids.len() == 0 {
            return RiskScore {
                subscriber: subscriber.clone(),
                subscription_id: 0,
                merchant_id: subscriber.clone(),
                total_score: 0,
                velocity_score: 0,
                anomaly_score: 0,
                chargeback_score: 0,
                device_mismatch_score: 0,
                geolocation_score: 0,
                pattern_shift_score: 0,
                action: FraudAction::Approve,
                reason: String::from_str(&env, "no subscription history"),
                assessed_at: env.ledger().timestamp(),
                signals: Vec::new(&env),
                evidence: Vec::new(&env),
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
                (
                    String::from_str(&env, "fraud_case_opened"),
                    score.subscription_id,
                ),
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
            case.reviewed_at = case.updated_at;
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

    pub fn submit_false_positive_feedback(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
    ) {
        subscriber.require_auth();

        if let Some(mut profile) = load_profile(&env, subscription_id) {
            profile.false_positive_count = profile.false_positive_count.saturating_add(1);
            profile.is_flagged = false;
            profile.is_blocked = false;
            profile.last_activity_at = env.ledger().timestamp();
            save_profile(&env, &profile);
        }

        if let Some(mut case) = review_case_for_subscription(&env, subscription_id) {
            case.status = FraudReviewStatus::Dismissed;
            case.updated_at = env.ledger().timestamp();
            case.reviewed_at = case.updated_at;
            case.action = FraudAction::Approve;
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
        let mut geolocation_alerts = 0u32;
        let mut chargeback_predictions = 0u32;
        let mut pending_evidence = 0u32;
        let mut false_positive_feedback = 0u32;
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
                if score.geolocation_score > 0 {
                    geolocation_alerts += 1;
                }
                if score.chargeback_score > 0 {
                    chargeback_predictions += 1;
                }
                if score.total_score >= REVIEW_THRESHOLD {
                    push_unique_address(&mut high_risk_subscribers, score.subscriber.clone());
                }

                if let Some(case) = review_case_for_subscription(&env, score.subscription_id) {
                    if case.evidence.len() == 0 {
                        pending_evidence += 1;
                    }
                    if case.status == FraudReviewStatus::Dismissed {
                        false_positive_feedback += 1;
                    }
                    recent_cases.push_back(case);
                } else if score.total_score >= REVIEW_THRESHOLD {
                    let case = persist_case(&env, &score, FraudReviewStatus::Pending);
                    if case.evidence.len() == 0 {
                        pending_evidence += 1;
                    }
                    recent_cases.push_back(case);
                }
            }
            i += 1;
        }

        let average_risk = if ids.len() == 0 {
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
            geolocation_alerts,
            chargeback_predictions,
            high_risk_subscribers: high_risk_subscribers.len(),
            pending_evidence_count: pending_evidence,
            false_positive_feedback_count: false_positive_feedback,
            recent_cases: trimmed_cases,
        }
    }
}
