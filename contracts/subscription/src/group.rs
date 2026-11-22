use soroban_sdk::{contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum GroupMemberRole {
    Owner,
    Admin,
    Member,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GroupMember {
    pub address: Address,
    pub role: GroupMemberRole,
    pub joined_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FamilyPlanRules {
    pub seat_limit: u32,
    pub owner_pays_for_members: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionGroup {
    pub id: u64,
    pub owner: Address,
    pub name: String,
    pub members: Vec<GroupMember>,
    pub rules: FamilyPlanRules,
}

pub fn can_add_member(_env: &Env, group: &SubscriptionGroup) -> bool {
    (group.members.len() as u32) < group.rules.seat_limit
}
