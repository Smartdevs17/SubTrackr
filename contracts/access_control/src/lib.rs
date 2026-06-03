#![no_std]

mod roles;

use roles::{contains_permission, role_permissions, DataKey, Delegation, MultisigAction, MultisigProposal};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use subtrackr_types::{Permission, Role, RoleChangeAction, RoleChangeEntry};

const DEFAULT_MULTISIG_THRESHOLD: u32 = 2;
const DEFAULT_MULTISIG_TIMELOCK: u64 = 86400;

fn save_role_change(
    env: &Env,
    user: &Address,
    role: &Role,
    action: RoleChangeAction,
    changed_by: &Address,
) {
    let mut count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::RoleChangeCount)
        .unwrap_or(0);
    count += 1;

    let entry = RoleChangeEntry {
        id: count,
        user: user.clone(),
        role: role.clone(),
        action,
        changed_by: changed_by.clone(),
        timestamp: env.ledger().timestamp(),
    };

    env.storage()
        .instance()
        .set(&DataKey::RoleChangeEntry(count), &entry);
    env.storage()
        .instance()
        .set(&DataKey::RoleChangeCount, &count);
}

fn get_user_permissions(env: &Env, user: &Address) -> Vec<Permission> {
    let roles_opt: Option<Vec<Role>> = env.storage().instance().get(&DataKey::UserRoles(user.clone()));
    let mut all_perms: Vec<Permission> = Vec::new(env);

    if let Some(roles) = roles_opt {
        for role in roles.iter() {
            let perms = role_permissions(env, &role);
            for p in perms.iter() {
                if !contains_permission(&all_perms, &p) {
                    all_perms.push_back(p);
                }
            }
        }
    }

    all_perms
}

fn vec_contains_address(vec: &Vec<Address>, address: &Address) -> bool {
    for item in vec.iter() {
        if &item == address {
            return true;
        }
    }
    false
}

#[contract]
pub struct RoleManager;

#[contractimpl]
impl RoleManager {
    pub fn initialize(env: Env, admin: Address, emergency_admin: Address) {
        assert!(
            !env.storage().instance().has(&DataKey::EmergencyAdmin),
            "Already initialized"
        );
        admin.require_auth();

        let mut members: Vec<Address> = Vec::new(&env);
        members.push_back(admin.clone());
        env.storage()
            .instance()
            .set(&DataKey::RoleMembers(Role::Admin), &members);

        let mut roles: Vec<Role> = Vec::new(&env);
        roles.push_back(Role::Admin);
        env.storage()
            .instance()
            .set(&DataKey::UserRoles(admin.clone()), &roles);

        env.storage()
            .instance()
            .set(&DataKey::EmergencyAdmin, &emergency_admin);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &false);

        env.storage()
            .instance()
            .set(&DataKey::MultisigThreshold, &DEFAULT_MULTISIG_THRESHOLD);
        env.storage()
            .instance()
            .set(&DataKey::MultisigTimelock, &DEFAULT_MULTISIG_TIMELOCK);
        env.storage()
            .instance()
            .set(&DataKey::MultisigProposalCount, &0u64);

        save_role_change(&env, &admin, &Role::Admin, RoleChangeAction::Granted, &admin);

        env.events().publish(
            (Symbol::new(&env, "access_control_initialized"),),
            (admin, emergency_admin),
        );
    }

    pub fn grant_role(env: Env, caller: Address, user: Address, role: Role) {
        caller.require_auth();
        assert!(
            !env.storage()
                .instance()
                .get(&DataKey::EmergencyPaused)
                .unwrap_or(false),
            "System is paused"
        );

        let caller_perms = get_user_permissions(&env, &caller);
        assert!(
            contains_permission(&caller_perms, &Permission::GrantRole),
            "Unauthorized: missing GrantRole permission"
        );

        let mut members: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RoleMembers(role.clone()))
            .unwrap_or(Vec::new(&env));

        if vec_contains_address(&members, &user) {
            return;
        }

        members.push_back(user.clone());
        env.storage()
            .instance()
            .set(&DataKey::RoleMembers(role.clone()), &members);

        let mut user_roles: Vec<Role> = env
            .storage()
            .instance()
            .get(&DataKey::UserRoles(user.clone()))
            .unwrap_or(Vec::new(&env));
        user_roles.push_back(role.clone());
        env.storage()
            .instance()
            .set(&DataKey::UserRoles(user.clone()), &user_roles);

        save_role_change(
            &env,
            &user,
            &role,
            RoleChangeAction::Granted,
            &caller,
        );

        env.events().publish(
            (Symbol::new(&env, "role_granted"),),
            (caller, user, role),
        );
    }

    pub fn revoke_role(env: Env, caller: Address, user: Address, role: Role) {
        caller.require_auth();
        assert!(
            !env.storage()
                .instance()
                .get(&DataKey::EmergencyPaused)
                .unwrap_or(false),
            "System is paused"
        );

        let caller_perms = get_user_permissions(&env, &caller);
        assert!(
            contains_permission(&caller_perms, &Permission::RevokeRole),
            "Unauthorized: missing RevokeRole permission"
        );

        if role == Role::Admin {
            let admin_members: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::RoleMembers(Role::Admin))
                .unwrap_or(Vec::new(&env));
            assert!(
                admin_members.len() > 1 || !vec_contains_address(&admin_members, &user),
                "Cannot revoke last admin"
            );
        }

        let members: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RoleMembers(role.clone()))
            .unwrap_or(Vec::new(&env));
        let mut new_members: Vec<Address> = Vec::new(&env);
        for m in members.iter() {
            if m != user {
                new_members.push_back(m);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::RoleMembers(role.clone()), &new_members);

        let user_roles: Vec<Role> = env
            .storage()
            .instance()
            .get(&DataKey::UserRoles(user.clone()))
            .unwrap_or(Vec::new(&env));
        let mut new_roles: Vec<Role> = Vec::new(&env);
        for r in user_roles.iter() {
            if r != role {
                new_roles.push_back(r);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::UserRoles(user.clone()), &new_roles);

        let delegation_perms = [
            Permission::ApproveRefund,
            Permission::RejectRefund,
            Permission::SetRateLimit,
            Permission::RemoveRateLimit,
            Permission::SetInvoiceContract,
            Permission::ClearInvoiceContract,
            Permission::SetPlanQuotas,
            Permission::SetRevenueRule,
            Permission::CreatePlan,
            Permission::DeactivatePlan,
            Permission::Subscribe,
            Permission::CancelSubscription,
            Permission::PauseSubscription,
            Permission::ResumeSubscription,
            Permission::ChargeSubscription,
            Permission::RequestRefund,
            Permission::RequestTransfer,
            Permission::AcceptTransfer,
            Permission::ViewAnalytics,
            Permission::ViewAuditLog,
            Permission::ViewPlans,
            Permission::ViewSubscriptions,
            Permission::GrantRole,
            Permission::RevokeRole,
            Permission::DelegatePermission,
            Permission::SetEmergencyAdmin,
            Permission::PauseEmergency,
            Permission::UpgradeContract,
            Permission::MigrateContract,
            Permission::SetAccessControl,
        ];
        for perm in delegation_perms.iter() {
            let key = DataKey::Delegation(user.clone(), perm.clone());
            if env.storage().instance().has(&key) {
                let del: Option<Delegation> = env.storage().instance().get(&key);
                if let Some(delegation) = del {
                    if delegation.delegate == user || delegation.delegator == user {
                        env.storage().instance().remove(&key);
                    }
                }
            }
        }

        save_role_change(
            &env,
            &user,
            &role,
            RoleChangeAction::Revoked,
            &caller,
        );

        env.events().publish(
            (Symbol::new(&env, "role_revoked"),),
            (caller, user, role),
        );
    }

    pub fn has_permission(env: Env, user: Address, permission: Permission) -> bool {
        if env.storage()
            .instance()
            .get::<_, bool>(&DataKey::EmergencyPaused)
            .unwrap_or(false)
        {
            return false;
        }

        let user_perms = get_user_permissions(&env, &user);
        if contains_permission(&user_perms, &permission) {
            return true;
        }

        let key = DataKey::Delegation(user.clone(), permission.clone());
        let del: Option<Delegation> = env.storage().instance().get(&key);
        if let Some(delegation) = del {
            if env.ledger().timestamp() <= delegation.expires_at {
                let delegator_perms = get_user_permissions(&env, &delegation.delegator);
                if contains_permission(&delegator_perms, &permission) {
                    return true;
                }
                env.storage().instance().remove(&key);
            } else {
                env.storage().instance().remove(&key);
            }
        }

        false
    }

    pub fn has_role(env: Env, user: Address, role: Role) -> bool {
        let members: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RoleMembers(role))
            .unwrap_or(Vec::new(&env));
        vec_contains_address(&members, &user)
    }

    pub fn get_user_roles(env: Env, user: Address) -> Vec<Role> {
        env.storage()
            .instance()
            .get(&DataKey::UserRoles(user))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_role_members(env: Env, role: Role) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::RoleMembers(role))
            .unwrap_or(Vec::new(&env))
    }

    pub fn delegate_permission(
        env: Env,
        delegator: Address,
        delegate: Address,
        permission: Permission,
        duration_secs: u64,
    ) {
        delegator.require_auth();
        assert!(
            !env.storage()
                .instance()
                .get::<_, bool>(&DataKey::EmergencyPaused)
                .unwrap_or(false),
            "System is paused"
        );

        let delegator_perms = get_user_permissions(&env, &delegator);
        assert!(
            contains_permission(&delegator_perms, &permission),
            "Delegator does not have this permission"
        );
        assert!(
            contains_permission(&delegator_perms, &Permission::DelegatePermission),
            "Unauthorized: missing DelegatePermission"
        );

        let expires_at = env
            .ledger()
            .timestamp()
            .saturating_add(duration_secs);

        let delegation = Delegation {
            delegator: delegator.clone(),
            permission: permission.clone(),
            delegate: delegate.clone(),
            expires_at,
        };

        let key = DataKey::Delegation(delegate.clone(), permission.clone());
        env.storage().instance().set(&key, &delegation);

        env.events().publish(
            (Symbol::new(&env, "permission_delegated"),),
            (delegator, delegate, permission, expires_at),
        );
    }

    pub fn revoke_delegation(env: Env, delegator: Address, delegate: Address, permission: Permission) {
        delegator.require_auth();

        let key = DataKey::Delegation(delegate.clone(), permission.clone());
        let del: Option<Delegation> = env.storage().instance().get(&key);
        if let Some(delegation) = del {
            if delegation.delegator == delegator {
                env.storage().instance().remove(&key);
            }
        }

        env.events().publish(
            (Symbol::new(&env, "delegation_revoked"),),
            (delegator, delegate, permission),
        );
    }

    pub fn set_emergency_admin(env: Env, caller: Address, new_emergency_admin: Address) {
        caller.require_auth();
        let caller_perms = get_user_permissions(&env, &caller);
        assert!(
            contains_permission(&caller_perms, &Permission::SetEmergencyAdmin),
            "Unauthorized: missing SetEmergencyAdmin permission"
        );

        env.storage()
            .instance()
            .set(&DataKey::EmergencyAdmin, &new_emergency_admin);

        env.events().publish(
            (Symbol::new(&env, "emergency_admin_set"),),
            (caller, new_emergency_admin),
        );
    }

    pub fn pause_emergency(env: Env, caller: Address) {
        caller.require_auth();
        let emergency_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::EmergencyAdmin)
            .expect("EmergencyAdmin not set");
        assert!(caller == emergency_admin, "Only emergency admin can pause");

        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &true);

        env.events()
            .publish((Symbol::new(&env, "emergency_paused"),), caller);
    }

    pub fn unpause_emergency(env: Env, caller: Address) {
        caller.require_auth();
        let caller_perms = get_user_permissions(&env, &caller);
        assert!(
            contains_permission(&caller_perms, &Permission::PauseEmergency),
            "Unauthorized: missing PauseEmergency permission"
        );

        env.storage()
            .instance()
            .set(&DataKey::EmergencyPaused, &false);

        env.events()
            .publish((Symbol::new(&env, "emergency_unpaused"),), caller);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::EmergencyPaused)
            .unwrap_or(false)
    }

    pub fn get_role_change_history(env: Env, limit: u32) -> Vec<RoleChangeEntry> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RoleChangeCount)
            .unwrap_or(0);

        let mut entries: Vec<RoleChangeEntry> = Vec::new(&env);
        let start = if count >= limit as u64 {
            count - limit as u64 + 1
        } else {
            1
        };

        let mut i = start;
        while i <= count {
            let entry: Option<RoleChangeEntry> =
                env.storage().instance().get(&DataKey::RoleChangeEntry(i));
            if let Some(e) = entry {
                entries.push_back(e);
            }
            i += 1;
        }

        entries
    }

    pub fn propose_multisig_action(
        env: Env,
        proposer: Address,
        action: MultisigAction,
    ) -> u64 {
        proposer.require_auth();
        assert!(
            !env.storage()
                .instance()
                .get::<_, bool>(&DataKey::EmergencyPaused)
                .unwrap_or(false),
            "System is paused"
        );

        let proposer_perms = get_user_permissions(&env, &proposer);
        assert!(
            contains_permission(&proposer_perms, &Permission::GrantRole),
            "Unauthorized: only admins can propose"
        );

        let mut seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MultisigProposalCount)
            .unwrap_or(0);
        seq += 1;
        env.storage()
            .instance()
            .set(&DataKey::MultisigProposalCount, &seq);

        let now = env.ledger().timestamp();
        let timelock: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MultisigTimelock)
            .unwrap_or(DEFAULT_MULTISIG_TIMELOCK);

        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = MultisigProposal {
            id: seq,
            action,
            proposer: proposer.clone(),
            created_at: now,
            execute_after: now.saturating_add(timelock),
            approvals,
            executed: false,
        };

        env.storage()
            .instance()
            .set(&DataKey::MultisigProposal(seq), &proposal);

        env.events().publish(
            (Symbol::new(&env, "multisig_proposal_created"),),
            (seq, proposer),
        );

        seq
    }

    pub fn approve_multisig_action(env: Env, approver: Address, proposal_id: u64) {
        approver.require_auth();

        let mut proposal: MultisigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultisigProposal(proposal_id))
            .expect("Proposal not found");

        assert!(!proposal.executed, "Proposal already executed");
        assert!(
            !vec_contains_address(&proposal.approvals, &approver),
            "Already approved"
        );

        let approver_perms = get_user_permissions(&env, &approver);
        assert!(
            contains_permission(&approver_perms, &Permission::GrantRole),
            "Unauthorized: only admins can approve"
        );

        proposal.approvals.push_back(approver.clone());
        env.storage()
            .instance()
            .set(&DataKey::MultisigProposal(proposal_id), &proposal);

        env.events().publish(
            (Symbol::new(&env, "multisig_proposal_approved"),),
            (proposal_id, proposal.approvals.len()),
        );
    }

    pub fn execute_multisig_action(env: Env, proposal_id: u64) {
        let proposal: MultisigProposal = env
            .storage()
            .instance()
            .get(&DataKey::MultisigProposal(proposal_id))
            .expect("Proposal not found");

        assert!(!proposal.executed, "Proposal already executed");

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MultisigThreshold)
            .unwrap_or(DEFAULT_MULTISIG_THRESHOLD);

        assert!(
            proposal.approvals.len() >= threshold,
            "Insufficient approvals"
        );

        let now = env.ledger().timestamp();
        assert!(
            now >= proposal.execute_after,
            "Timelock not yet elapsed"
        );

        match proposal.action {
            MultisigAction::SetEmergencyAdmin(ref new_admin) => {
                env.storage()
                    .instance()
                    .set(&DataKey::EmergencyAdmin, new_admin);
            }
            MultisigAction::SetMultisigThreshold(new_threshold) => {
                env.storage()
                    .instance()
                    .set(&DataKey::MultisigThreshold, &new_threshold);
            }
            MultisigAction::UpgradeContract => {}
            MultisigAction::MigrateContract => {}
            MultisigAction::EmergencyUnpause => {
                env.storage()
                    .instance()
                    .set(&DataKey::EmergencyPaused, &false);
            }
        }

        let mut executed = proposal;
        executed.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::MultisigProposal(proposal_id), &executed);

        env.events().publish(
            (Symbol::new(&env, "multisig_action_executed"),),
            proposal_id,
        );
    }

    pub fn get_multisig_proposal(env: Env, proposal_id: u64) -> MultisigProposal {
        env.storage()
            .instance()
            .get(&DataKey::MultisigProposal(proposal_id))
            .expect("Proposal not found")
    }
}

#[cfg(test)]
mod test;
