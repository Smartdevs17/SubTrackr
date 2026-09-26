use soroban_sdk::{contracttype, Address, Env, Vec};
use subtrackr_types::{Permission, Role};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Delegation {
    pub delegator: Address,
    pub permission: Permission,
    pub delegate: Address,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MultisigAction {
    UpgradeContract,
    MigrateContract,
    EmergencyUnpause,
    SetEmergencyAdmin(Address),
    SetMultisigThreshold(u32),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MultisigProposal {
    pub id: u64,
    pub action: MultisigAction,
    pub proposer: Address,
    pub created_at: u64,
    pub execute_after: u64,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    RoleMembers(Role),
    UserRoles(Address),
    Delegation(Address, Permission),
    EmergencyAdmin,
    EmergencyPaused,
    RoleChangeCount,
    RoleChangeEntry(u64),
    MultisigProposal(u64),
    MultisigProposalCount,
    MultisigThreshold,
    MultisigTimelock,
}

pub fn role_permissions(env: &Env, role: &Role) -> Vec<Permission> {
    match role {
        Role::Admin => {
            let mut perms = Vec::new(env);
            perms.push_back(Permission::GrantRole);
            perms.push_back(Permission::RevokeRole);
            perms.push_back(Permission::DelegatePermission);
            perms.push_back(Permission::CreatePlan);
            perms.push_back(Permission::DeactivatePlan);
            perms.push_back(Permission::SetPlanQuotas);
            perms.push_back(Permission::SetRevenueRule);
            perms.push_back(Permission::Subscribe);
            perms.push_back(Permission::CancelSubscription);
            perms.push_back(Permission::PauseSubscription);
            perms.push_back(Permission::ResumeSubscription);
            perms.push_back(Permission::ChargeSubscription);
            perms.push_back(Permission::RequestRefund);
            perms.push_back(Permission::ApproveRefund);
            perms.push_back(Permission::RejectRefund);
            perms.push_back(Permission::RequestTransfer);
            perms.push_back(Permission::AcceptTransfer);
            perms.push_back(Permission::SetRateLimit);
            perms.push_back(Permission::RemoveRateLimit);
            perms.push_back(Permission::SetInvoiceContract);
            perms.push_back(Permission::ClearInvoiceContract);
            perms.push_back(Permission::UpgradeContract);
            perms.push_back(Permission::MigrateContract);
            perms.push_back(Permission::ViewAnalytics);
            perms.push_back(Permission::ViewAuditLog);
            perms.push_back(Permission::ViewPlans);
            perms.push_back(Permission::ViewSubscriptions);
            perms.push_back(Permission::SetEmergencyAdmin);
            perms.push_back(Permission::PauseEmergency);
            perms.push_back(Permission::SetAccessControl);
            perms
        }
        Role::Merchant => {
            let mut perms = Vec::new(env);
            perms.push_back(Permission::CreatePlan);
            perms.push_back(Permission::DeactivatePlan);
            perms.push_back(Permission::SetPlanQuotas);
            perms.push_back(Permission::SetRevenueRule);
            perms.push_back(Permission::DelegatePermission);
            perms.push_back(Permission::ViewPlans);
            perms.push_back(Permission::ViewSubscriptions);
            perms
        }
        Role::Subscriber => {
            let mut perms = Vec::new(env);
            perms.push_back(Permission::Subscribe);
            perms.push_back(Permission::CancelSubscription);
            perms.push_back(Permission::PauseSubscription);
            perms.push_back(Permission::ResumeSubscription);
            perms.push_back(Permission::ChargeSubscription);
            perms.push_back(Permission::RequestRefund);
            perms.push_back(Permission::RequestTransfer);
            perms.push_back(Permission::AcceptTransfer);
            perms
        }
        Role::Auditor => {
            let mut perms = Vec::new(env);
            perms.push_back(Permission::ViewAnalytics);
            perms.push_back(Permission::ViewAuditLog);
            perms.push_back(Permission::ViewPlans);
            perms.push_back(Permission::ViewSubscriptions);
            perms
        }
    }
}

pub fn contains_permission(perms: &Vec<Permission>, target: &Permission) -> bool {
    for p in perms.iter() {
        if &p == target {
            return true;
        }
    }
    false
}
