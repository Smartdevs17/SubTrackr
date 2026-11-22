//! Family plan support with a shared paying wallet (#2031).
//!
//! A subscription's subscriber is the paying wallet: every renewal is charged
//! to it, exactly as for a single-user plan. The payer can invite other
//! addresses into a family group attached to that subscription. Members share
//! the entitlement and never pay; the payer controls membership and the seat
//! limit, and a member may leave at any time.
//!
//! The group is stored per subscription ID. It is only usable while the
//! subscription is Active or Paused, and it is cleared when the subscription
//! is cancelled (see `lib.rs`).

use soroban_sdk::{contracttype, Address, Env, String, Vec};

/// Hard cap on seats, including the payer. Bounds storage and loop costs.
pub const MAX_FAMILY_SEATS: u32 = 10;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FamilyGroup {
    pub subscription_id: u64,
    /// The shared paying wallet (the subscription's subscriber).
    pub payer: Address,
    /// Seats in total, including the payer.
    pub max_seats: u32,
    /// Members other than the payer.
    pub members: Vec<Address>,
}

pub fn get(env: &Env, subscription_id: u64) -> Option<FamilyGroup> {
    crate::feature_get(env, crate::FeatureStoreKey::FamilyGroup(subscription_id))
}

fn save(env: &Env, group: &FamilyGroup) {
    crate::feature_set(
        env,
        crate::FeatureStoreKey::FamilyGroup(group.subscription_id),
        group.clone(),
    );
}

pub fn create(env: &Env, subscription_id: u64, payer: &Address, max_seats: u32) -> FamilyGroup {
    assert!(get(env, subscription_id).is_none(), "Family group exists");
    assert!(
        (2..=MAX_FAMILY_SEATS).contains(&max_seats),
        "Seats must be between 2 and the family maximum"
    );
    let group = FamilyGroup {
        subscription_id,
        payer: payer.clone(),
        max_seats,
        members: Vec::new(env),
    };
    save(env, &group);
    env.events().publish(
        (String::from_str(env, "family_created"), payer.clone()),
        (subscription_id, max_seats),
    );
    group
}

pub fn add_member(env: &Env, subscription_id: u64, member: &Address) -> FamilyGroup {
    let mut group = get(env, subscription_id).expect("Family group not found");
    assert!(*member != group.payer, "Payer already holds a seat");
    assert!(!group.members.contains(member), "Already a member");
    assert!(
        group.members.len() + 1 < group.max_seats,
        "No free family seats"
    );
    group.members.push_back(member.clone());
    save(env, &group);
    env.events().publish(
        (String::from_str(env, "family_member_added"), member.clone()),
        (subscription_id, group.members.len()),
    );
    group
}

pub fn remove_member(env: &Env, subscription_id: u64, member: &Address) -> FamilyGroup {
    let mut group = get(env, subscription_id).expect("Family group not found");
    let idx = group
        .members
        .first_index_of(member)
        .expect("Not a family member");
    group.members.remove(idx);
    save(env, &group);
    env.events().publish(
        (
            String::from_str(env, "family_member_removed"),
            member.clone(),
        ),
        (subscription_id, group.members.len()),
    );
    group
}

/// True for the payer and every member.
pub fn has_access(env: &Env, subscription_id: u64, who: &Address) -> bool {
    match get(env, subscription_id) {
        Some(g) => g.payer == *who || g.members.contains(who),
        None => false,
    }
}

pub fn clear(env: &Env, subscription_id: u64) {
    crate::feature_remove(env, crate::FeatureStoreKey::FamilyGroup(subscription_id));
}
