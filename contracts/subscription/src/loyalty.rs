/// Loyalty & Rewards module for SubTrackr subscriptions.
///
/// On-chain points, tiered benefits, streaks, referral bonuses, and
/// points redemption — all stored in the shared storage contract.
use soroban_sdk::{Address, Env, String, Vec};
use subtrackr_types::{
    LoyaltyConfig, LoyaltyTierConfig, PointTransaction, PointTxType, RewardsRedemption,
    StorageKey,
};

use crate::{storage_persistent_get, storage_persistent_set};

// ── Constants ──────────────────────────────────────────────────────────────────

/// Maximum points a single subscriber can hold (anti-inflation).
const MAX_POINTS: u64 = 10_000_000;
/// Minimum charge amount needed to earn points.
const MIN_CHARGE_FOR_POINTS: i128 = 100_000;

// ── Config ─────────────────────────────────────────────────────────────────────

pub fn set_loyalty_config(env: &Env, storage: &Address, config: &LoyaltyConfig) {
    storage_persistent_set(env, storage, StorageKey::LoyaltyConfig, config);
}

pub fn get_loyalty_config(env: &Env, storage: &Address) -> Option<LoyaltyConfig> {
    storage_persistent_get(env, storage, StorageKey::LoyaltyConfig)
}

// ── Points ─────────────────────────────────────────────────────────────────────

pub fn get_points(env: &Env, storage: &Address, subscriber: &Address) -> u64 {
    storage_persistent_get::<u64>(env, storage, StorageKey::LoyaltyPoints(subscriber.clone()))
        .unwrap_or(0)
}

pub fn get_lifetime_points(env: &Env, storage: &Address, subscriber: &Address) -> u64 {
    storage_persistent_get::<u64>(env, storage, StorageKey::LifetimePoints(subscriber.clone()))
        .unwrap_or(0)
}

pub fn get_total_spent(env: &Env, storage: &Address, subscriber: &Address) -> i128 {
    storage_persistent_get::<i128>(env, storage, StorageKey::TotalSpent(subscriber.clone()))
        .unwrap_or(0)
}

/// Accumulate points after a successful charge.
///
/// Called from the `charge_subscription` flow in lib.rs.
pub fn accumulate_points(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    charge_amount: i128,
    charge_time: u64,
) {
    if charge_amount < MIN_CHARGE_FOR_POINTS {
        return;
    }
    let config = match get_loyalty_config(env, storage) {
        Some(c) => c,
        None => return, // loyalty not initialised
    };

    let current = get_points(env, storage, subscriber);
    let lifetime = get_lifetime_points(env, storage, subscriber);
    let total_spent = get_total_spent(env, storage, subscriber);

    let points_earned = (charge_amount as u64).saturating_mul(config.points_per_dollar) / 1_000_000;
    if points_earned == 0 {
        return;
    }

    let new_points = (current + points_earned).min(MAX_POINTS);
    let new_lifetime = lifetime + points_earned;

    storage_persistent_set(env, storage, StorageKey::LoyaltyPoints(subscriber.clone()), new_points);
    storage_persistent_set(env, storage, StorageKey::LifetimePoints(subscriber.clone()), new_lifetime);
    storage_persistent_set(env, storage, StorageKey::TotalSpent(subscriber.clone()), total_spent + charge_amount);

    // Track first participation as "member since"
    if storage_persistent_get::<u64>(env, storage, StorageKey::MemberSince(subscriber.clone())).is_none() {
        storage_persistent_set(env, storage, StorageKey::MemberSince(subscriber.clone()), charge_time);
    }

    // Update streak
    update_streak(env, storage, subscriber, charge_time);

    // Set points expiration if not set
    if storage_persistent_get::<u64>(env, storage, StorageKey::PointsExpiration(subscriber.clone())).is_none() {
        let expires_at = charge_time + config.expiration_days * 86_400;
        storage_persistent_set(env, storage, StorageKey::PointsExpiration(subscriber.clone()), expires_at);
    }

    // Record transaction
    record_tx(
        env,
        storage,
        subscriber,
        points_earned as i128,
        PointTxType::Earned,
        charge_time,
        0,
        String::from_slice(env, b"points earned from charge"),
    );
}

/// Eligible points balance after checking expiry.
pub fn get_eligible_points(env: &Env, storage: &Address, subscriber: &Address) -> u64 {
    let now = env.ledger().timestamp();
    let expires_at: Option<u64> =
        storage_persistent_get(env, storage, StorageKey::PointsExpiration(subscriber.clone()));
    let expired = expires_at.map_or(false, |exp| now >= exp);

    if expired {
        let pts = get_points(env, storage, subscriber);
        if pts > 0 {
            record_tx(
                env,
                storage,
                subscriber,
                -(pts as i128),
                PointTxType::Expired,
                now,
                0,
                String::from_slice(env, b"points expired"),
            );
            storage_persistent_set(env, storage, StorageKey::LoyaltyPoints(subscriber.clone()), 0u64);
            storage_persistent_set::<Option<u64>>(env, storage, StorageKey::PointsExpiration(subscriber.clone()), None);
        }
        0
    } else {
        get_points(env, storage, subscriber)
    }
}

// ── Streaks ────────────────────────────────────────────────────────────────────

pub fn get_streak(env: &Env, storage: &Address, subscriber: &Address) -> u64 {
    storage_persistent_get::<u64>(env, storage, StorageKey::Streak(subscriber.clone())).unwrap_or(0)
}

fn update_streak(env: &Env, storage: &Address, subscriber: &Address, charge_time: u64) {
    let last_charge: Option<u64> =
        storage_persistent_get(env, storage, StorageKey::LastChargeAt(subscriber.clone()));
    let current_streak = get_streak(env, storage, subscriber);

    let new_streak = match last_charge {
        Some(last) => {
            let config = get_loyalty_config(env, storage);
            let threshold = config.map_or(86_400, |c| c.streak_bonus_threshold);
            if charge_time >= last && charge_time - last <= threshold {
                current_streak + 1
            } else {
                1
            }
        }
        None => 1,
    };

    storage_persistent_set(env, storage, StorageKey::Streak(subscriber.clone()), new_streak);
    storage_persistent_set(env, storage, StorageKey::LastChargeAt(subscriber.clone()), charge_time);

    // Award streak bonus points at milestones
    if new_streak > 0 && new_streak % 10 == 0 {
        let bonus = (new_streak / 10) * 100;
        let current = get_points(env, storage, subscriber);
        let new = (current + bonus).min(MAX_POINTS);
        storage_persistent_set(env, storage, StorageKey::LoyaltyPoints(subscriber.clone()), new);
        record_tx(
            env,
            storage,
            subscriber,
            bonus as i128,
            PointTxType::StreakBonus,
            charge_time,
            0,
            &String::from_slice(env, b"streak bonus"),
        );
    }
}

// ── Tiers ──────────────────────────────────────────────────────────────────────

/// Determine the subscriber's current tier based on lifetime points.
pub fn get_current_tier(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
) -> Option<LoyaltyTierConfig> {
    let config = get_loyalty_config(env, storage)?;
    let lifetime = get_lifetime_points(env, storage, subscriber);

    let mut best: Option<LoyaltyTierConfig> = None;
    for tier in config.tiers.iter() {
        if lifetime >= tier.points_threshold {
            best = Some(tier);
        }
    }
    best
}

// ── Referral bonus ─────────────────────────────────────────────────────────────

pub fn earn_referral_bonus(
    env: &Env,
    storage: &Address,
    referrer: &Address,
    charge_time: u64,
) {
    let config = match get_loyalty_config(env, storage) {
        Some(c) => c,
        None => return,
    };
    let bonus = config.points_per_dollar.saturating_mul(100); // flat bonus per referral
    let current = get_points(env, storage, referrer);
    let lifetime = get_lifetime_points(env, storage, referrer);
    let new_points = (current + bonus).min(MAX_POINTS);

    storage_persistent_set(env, storage, StorageKey::LoyaltyPoints(referrer.clone()), new_points);
    storage_persistent_set(env, storage, StorageKey::LifetimePoints(referrer.clone()), lifetime + bonus);

    record_tx(
        env,
        storage,
        referrer,
        bonus as i128,
        PointTxType::ReferralBonus,
        charge_time,
        0,
        String::from_slice(env, b"referral bonus"),
    );
}

// ── Redemption ─────────────────────────────────────────────────────────────────

/// Redeem points for a discount on the next charge.
///
/// Returns the discount amount in token base units.
pub fn redeem_points(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    points: u64,
    charge_amount: i128,
    charge_time: u64,
) -> i128 {
    if points == 0 {
        return 0;
    }
    let eligible = get_eligible_points(env, storage, subscriber);
    let actual = points.min(eligible);
    if actual == 0 {
        return 0;
    }

    // Convert points to discount: 100 points = 1% of charge, capped at 50%
    let discount_bps = (actual / 100).min(5000); // 5000 bps = 50%
    let discount = (charge_amount * discount_bps as i128) / 10_000;
    if discount <= 0 {
        return 0;
    }

    // Deduct points
    let remaining = get_points(env, storage, subscriber) - actual;
    storage_persistent_set(env, storage, StorageKey::LoyaltyPoints(subscriber.clone()), remaining);

    // Record redemption
    let redemption_id = next_redemption_id(env, storage);
    storage_persistent_set(
        env,
        storage,
        StorageKey::Redemption(redemption_id),
        RewardsRedemption {
            id: redemption_id,
            subscriber: subscriber.clone(),
            points_cost: actual,
            discount_amount: discount,
            timestamp: charge_time,
        },
    );

    record_tx(
        env,
        storage,
        subscriber,
        -(actual as i128),
        PointTxType::Redeemed,
        charge_time,
        redemption_id,
        String::from_slice(env, b"points redeemed for discount"),
    );

    discount
}

pub fn get_redemption(
    env: &Env,
    storage: &Address,
    redemption_id: u64,
) -> Option<RewardsRedemption> {
    storage_persistent_get(env, storage, StorageKey::Redemption(redemption_id))
}

// ── History ────────────────────────────────────────────────────────────────────

pub fn get_point_transactions(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
) -> Vec<PointTransaction> {
    let count: u64 =
        storage_persistent_get(env, storage, StorageKey::PointTxCount).unwrap_or(0);
    let mut txs: Vec<PointTransaction> = Vec::new(env);
    for i in 1..=count {
        if let Some(tx) =
            storage_persistent_get::<PointTransaction>(env, storage, StorageKey::PointTx(i))
        {
            if tx.subscriber == *subscriber {
                txs.push_back(tx);
            }
        }
    }
    txs
}

// ── Admin utility ──────────────────────────────────────────────────────────────

/// Manually expire all points for a subscriber.
pub fn expire_points(env: &Env, storage: &Address, subscriber: &Address) {
    let pts = get_points(env, storage, subscriber);
    if pts > 0 {
        let now = env.ledger().timestamp();
        record_tx(
            env,
            storage,
            subscriber,
            -(pts as i128),
            PointTxType::Expired,
            now,
            0,
            String::from_slice(env, b"admin-forced expiry"),
        );
        storage_persistent_set(env, storage, StorageKey::LoyaltyPoints(subscriber.clone()), 0u64);
        storage_persistent_set::<Option<u64>>(env, storage, StorageKey::PointsExpiration(subscriber.clone()), None);
    }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

fn next_tx_id(env: &Env, storage: &Address) -> u64 {
    let count: u64 = storage_persistent_get(env, storage, StorageKey::PointTxCount).unwrap_or(0);
    let next = count + 1;
    storage_persistent_set(env, storage, StorageKey::PointTxCount, next);
    next
}

fn next_redemption_id(env: &Env, storage: &Address) -> u64 {
    let count: u64 = storage_persistent_get(env, storage, StorageKey::RedemptionCount).unwrap_or(0);
    let next = count + 1;
    storage_persistent_set(env, storage, StorageKey::RedemptionCount, next);
    next
}

fn record_tx(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    amount: i128,
    tx_type: PointTxType,
    timestamp: u64,
    reference_id: u64,
    description: String,
) {
    let id = next_tx_id(env, storage);
    let tx = PointTransaction {
        id,
        subscriber: subscriber.clone(),
        amount,
        tx_type,
        timestamp,
        reference_id,
        description,
    };
    storage_persistent_set(env, storage, StorageKey::PointTx(id), tx);
}
