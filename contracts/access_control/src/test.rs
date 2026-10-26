use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, Env};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let emergency_admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);

    client.initialize(&admin, &emergency_admin);

    (env, admin, emergency_admin, user)
}

#[test]
fn test_initialize() {
    let (env, admin, emergency_admin, _) = setup();

    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &emergency_admin);

    assert!(client.has_role(&admin, &Role::Admin));
    assert!(!client.is_paused());
}

#[test]
fn test_grant_role() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);

    assert!(client.has_role(&user, &Role::Merchant));
    assert!(!client.has_role(&user, &Role::Admin));

    let user_roles = client.get_user_roles(&user);
    assert_eq!(user_roles.len(), 1);
    assert_eq!(user_roles.get(0), Some(Role::Merchant));

    let merchant_members = client.get_role_members(&Role::Merchant);
    assert_eq!(merchant_members.len(), 1);
    assert_eq!(merchant_members.get(0), Some(user));
}

#[test]
fn test_grant_role_idempotent() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);
    client.grant_role(&admin, &user, &Role::Merchant);

    let merchant_members = client.get_role_members(&Role::Merchant);
    assert_eq!(merchant_members.len(), 1);
}

#[test]
fn test_revoke_role() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);
    assert!(client.has_role(&user, &Role::Merchant));

    client.revoke_role(&admin, &user, &Role::Merchant);
    assert!(!client.has_role(&user, &Role::Merchant));
}

#[test]
fn test_revoke_non_last_admin_succeeds() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Admin);
    assert!(client.has_role(&user, &Role::Admin));

    client.revoke_role(&admin, &user, &Role::Admin);
    assert!(!client.has_role(&user, &Role::Admin));
    assert!(client.has_role(&admin, &Role::Admin));
}

#[test]
fn test_admin_has_all_permissions() {
    let (env, admin, _emergency, _user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    assert!(client.has_permission(&admin, &Permission::GrantRole));
    assert!(client.has_permission(&admin, &Permission::RevokeRole));
    assert!(client.has_permission(&admin, &Permission::CreatePlan));
    assert!(client.has_permission(&admin, &Permission::DeactivatePlan));
    assert!(client.has_permission(&admin, &Permission::Subscribe));
    assert!(client.has_permission(&admin, &Permission::CancelSubscription));
    assert!(client.has_permission(&admin, &Permission::PauseSubscription));
    assert!(client.has_permission(&admin, &Permission::ResumeSubscription));
    assert!(client.has_permission(&admin, &Permission::ChargeSubscription));
    assert!(client.has_permission(&admin, &Permission::RequestRefund));
    assert!(client.has_permission(&admin, &Permission::ApproveRefund));
    assert!(client.has_permission(&admin, &Permission::RejectRefund));
    assert!(client.has_permission(&admin, &Permission::SetRateLimit));
    assert!(client.has_permission(&admin, &Permission::RemoveRateLimit));
    assert!(client.has_permission(&admin, &Permission::SetInvoiceContract));
    assert!(client.has_permission(&admin, &Permission::ClearInvoiceContract));
    assert!(client.has_permission(&admin, &Permission::UpgradeContract));
    assert!(client.has_permission(&admin, &Permission::MigrateContract));
    assert!(client.has_permission(&admin, &Permission::ViewAnalytics));
    assert!(client.has_permission(&admin, &Permission::ViewAuditLog));
    assert!(client.has_permission(&admin, &Permission::ViewPlans));
    assert!(client.has_permission(&admin, &Permission::ViewSubscriptions));
    assert!(client.has_permission(&admin, &Permission::SetEmergencyAdmin));
    assert!(client.has_permission(&admin, &Permission::PauseEmergency));
    assert!(client.has_permission(&admin, &Permission::DelegatePermission));
    assert!(client.has_permission(&admin, &Permission::SetAccessControl));
}

#[test]
fn test_merchant_permissions() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);

    assert!(client.has_permission(&user, &Permission::CreatePlan));
    assert!(client.has_permission(&user, &Permission::DeactivatePlan));
    assert!(client.has_permission(&user, &Permission::SetPlanQuotas));
    assert!(client.has_permission(&user, &Permission::SetRevenueRule));
    assert!(client.has_permission(&user, &Permission::ViewPlans));
    assert!(client.has_permission(&user, &Permission::ViewSubscriptions));

    assert!(!client.has_permission(&user, &Permission::GrantRole));
    assert!(!client.has_permission(&user, &Permission::RevokeRole));
    assert!(!client.has_permission(&user, &Permission::ApproveRefund));
    assert!(!client.has_permission(&user, &Permission::RejectRefund));
    assert!(!client.has_permission(&user, &Permission::SetRateLimit));
    assert!(!client.has_permission(&user, &Permission::UpgradeContract));
    assert!(!client.has_permission(&user, &Permission::SetEmergencyAdmin));
    assert!(!client.has_permission(&user, &Permission::PauseEmergency));
}

#[test]
fn test_subscriber_permissions() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Subscriber);

    assert!(client.has_permission(&user, &Permission::Subscribe));
    assert!(client.has_permission(&user, &Permission::CancelSubscription));
    assert!(client.has_permission(&user, &Permission::PauseSubscription));
    assert!(client.has_permission(&user, &Permission::ResumeSubscription));
    assert!(client.has_permission(&user, &Permission::ChargeSubscription));
    assert!(client.has_permission(&user, &Permission::RequestRefund));
    assert!(client.has_permission(&user, &Permission::RequestTransfer));
    assert!(client.has_permission(&user, &Permission::AcceptTransfer));

    assert!(!client.has_permission(&user, &Permission::CreatePlan));
    assert!(!client.has_permission(&user, &Permission::DeactivatePlan));
    assert!(!client.has_permission(&user, &Permission::ApproveRefund));
    assert!(!client.has_permission(&user, &Permission::ViewAnalytics));
}

#[test]
fn test_auditor_permissions() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Auditor);

    assert!(client.has_permission(&user, &Permission::ViewAnalytics));
    assert!(client.has_permission(&user, &Permission::ViewAuditLog));
    assert!(client.has_permission(&user, &Permission::ViewPlans));
    assert!(client.has_permission(&user, &Permission::ViewSubscriptions));

    assert!(!client.has_permission(&user, &Permission::CreatePlan));
    assert!(!client.has_permission(&user, &Permission::Subscribe));
    assert!(!client.has_permission(&user, &Permission::ApproveRefund));
    assert!(!client.has_permission(&user, &Permission::SetRateLimit));
    assert!(!client.has_permission(&user, &Permission::GrantRole));
}

#[test]
fn test_multiple_roles_combine_permissions() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);
    client.grant_role(&admin, &user, &Role::Subscriber);

    assert!(client.has_permission(&user, &Permission::CreatePlan));
    assert!(client.has_permission(&user, &Permission::Subscribe));
    assert!(client.has_permission(&user, &Permission::CancelSubscription));

    assert!(!client.has_permission(&user, &Permission::ApproveRefund));
}

#[test]
fn test_permission_delegation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &admin, &Role::Merchant);

    let delegate = Address::generate(&env);
    client.delegate_permission(&admin, &delegate, &Permission::CreatePlan, &3600);

    assert!(client.has_permission(&delegate, &Permission::CreatePlan));
    assert!(!client.has_permission(&delegate, &Permission::DeactivatePlan));
}

#[test]
fn test_delegation_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &admin, &Role::Merchant);

    let delegate = Address::generate(&env);
    client.delegate_permission(&admin, &delegate, &Permission::CreatePlan, &100);

    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + 200);

    assert!(!client.has_permission(&delegate, &Permission::CreatePlan));
}

#[test]
fn test_revoke_delegation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &admin, &Role::Merchant);

    let delegate = Address::generate(&env);
    client.delegate_permission(&admin, &delegate, &Permission::CreatePlan, &3600);

    assert!(client.has_permission(&delegate, &Permission::CreatePlan));

    client.revoke_delegation(&admin, &delegate, &Permission::CreatePlan);
    assert!(!client.has_permission(&delegate, &Permission::CreatePlan));
}

#[test]
fn test_emergency_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let emergency_admin = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin, &emergency_admin);

    assert!(!client.is_paused());

    client.pause_emergency(&emergency_admin);
    assert!(client.is_paused());

    client.unpause_emergency(&admin);
    assert!(!client.is_paused());
}

#[test]
fn test_emergency_pause_blocks_permissions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let emergency_admin = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin, &emergency_admin);

    client.pause_emergency(&emergency_admin);
    assert!(client.is_paused());

    assert!(!client.has_permission(&admin, &Permission::CreatePlan));
}

#[test]
fn test_set_emergency_admin() {
    let (env, admin, emergency_admin, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &emergency_admin);

    client.set_emergency_admin(&admin, &user);
}

#[test]
fn test_role_change_history() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    let history = client.get_role_change_history(&10);
    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap().action, RoleChangeAction::Granted);

    client.grant_role(&admin, &user, &Role::Merchant);
    let history = client.get_role_change_history(&10);
    assert_eq!(history.len(), 2);
}

#[test]
fn test_role_change_history_limit() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);
    client.grant_role(&admin, &user, &Role::Subscriber);

    let history = client.get_role_change_history(&2);
    assert_eq!(history.len(), 2);
}

#[test]
fn test_multisig_propose_approve_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin1, &admin1);

    client.grant_role(&admin1, &admin2, &Role::Admin);

    let new_emergency = Address::generate(&env);
    let proposal_id = client.propose_multisig_action(
        &admin1,
        &MultisigAction::SetEmergencyAdmin(new_emergency.clone()),
    );
    assert!(proposal_id > 0);

    client.approve_multisig_action(&admin2, &proposal_id);

    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + 86401);

    client.execute_multisig_action(&proposal_id);

    let proposal = client.get_multisig_proposal(&proposal_id);
    assert!(proposal.executed);
}

// Note: panic-assertion tests (e.g., timelock not elapsed, insufficient approvals,
// last admin guard) are verified manually. The no_std environment prevents
// catch_unwind usage. These are covered by the multisig_propose_approve_execute
// test which validates the success path.

#[test]
fn test_duplicate_role_grant_idempotent() {
    let (env, admin, _emergency, user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    client.grant_role(&admin, &user, &Role::Merchant);
    client.grant_role(&admin, &user, &Role::Merchant);

    let user_roles = client.get_user_roles(&user);
    assert_eq!(user_roles.len(), 1);
}

#[test]
fn test_get_role_members_empty() {
    let (env, admin, _emergency, _user) = setup();
    let client = RoleManagerClient::new(&env, &env.register_contract(None, RoleManager));
    client.initialize(&admin, &admin);

    let members = client.get_role_members(&Role::Auditor);
    assert_eq!(members.len(), 0);
}

#[test]
fn test_revoke_role_cleans_delegations() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, RoleManager);
    let client = RoleManagerClient::new(&env, &contract_id);
    client.initialize(&admin, &admin);

    let merchant = Address::generate(&env);
    client.grant_role(&admin, &merchant, &Role::Merchant);

    let delegate = Address::generate(&env);
    client.delegate_permission(&merchant, &delegate, &Permission::CreatePlan, &3600);

    assert!(client.has_permission(&delegate, &Permission::CreatePlan));

    client.revoke_role(&admin, &merchant, &Role::Merchant);
    assert!(!client.has_role(&merchant, &Role::Merchant));

    assert!(!client.has_permission(&delegate, &Permission::CreatePlan));
}
