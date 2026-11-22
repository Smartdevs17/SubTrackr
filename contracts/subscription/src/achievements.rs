/// Gamification & Achievement tracking module for SubTrackr subscriptions.
///
/// Records user achievement unlocks on-chain and awards loyalty/gamification XP.
use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

use crate::{storage_persistent_get, storage_persistent_set};

/// Storage key for achievement tracking.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AchievementKey {
    /// List of earned achievement IDs (Symbols) for a subscriber.
    UserAchievements(Address),
}

/// Retrieve all unlocked achievement IDs (Symbols) for a subscriber.
pub fn get_earned_achievements(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
) -> Vec<Symbol> {
    storage_persistent_get::<Vec<Symbol>>(
        env,
        storage,
        AchievementKey::UserAchievements(subscriber.clone()),
    )
    .unwrap_or_else(|| Vec::new(env))
}

/// Check if a subscriber has unlocked a specific achievement.
pub fn has_achievement(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    achievement_id: Symbol,
) -> bool {
    let achievements = get_earned_achievements(env, storage, subscriber);
    achievements.contains(achievement_id)
}

/// Record an achievement unlock for a subscriber.
/// If the achievement was not already unlocked, records it and returns true.
pub fn record_achievement(
    env: &Env,
    storage: &Address,
    subscriber: &Address,
    achievement_id: Symbol,
) -> bool {
    let mut achievements = get_earned_achievements(env, storage, subscriber);
    if achievements.contains(achievement_id) {
        return false;
    }
    achievements.push_back(achievement_id);
    storage_persistent_set(
        env,
        storage,
        AchievementKey::UserAchievements(subscriber.clone()),
        &achievements,
    );
    true
}
