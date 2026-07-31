use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, String};

fn setup() -> (Env, SubTrackrCreditClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubTrackrCredit);
    let client = SubTrackrCreditClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

#[test]
fn issues_and_reads_balance() {
    let (env, client, _admin) = setup();
    let sub = Address::generate(&env);
    let reason = String::from_str(&env, "promo");
    client.issue_credit(&sub, &500, &reason, &None);
    assert_eq!(client.get_credit_balance(&sub), 500);
    assert_eq!(client.get_transactions(&sub).len(), 1);
}

#[test]
fn rejects_non_positive_issuance() {
    let (env, client, _admin) = setup();
    let sub = Address::generate(&env);
    let reason = String::from_str(&env, "bad");
    let res = client.try_issue_credit(&sub, &0, &reason, &None);
    assert_eq!(res, Err(Ok(CreditError::InvalidAmount)));
}

#[test]
fn applies_credit_capped_at_amount_due() {
    let (env, client, _admin) = setup();
    let sub = Address::generate(&env);
    let reason = String::from_str(&env, "refund");
    client.issue_credit(&sub, &300, &reason, &None);

    // Charge larger than balance: applies the whole balance, leaves a remainder.
    let applied = client.apply_credit(&sub, &42, &500);
    assert_eq!(applied.applied, 300);
    assert_eq!(applied.remaining_due, 200);
    assert_eq!(applied.balance_after, 0);

    // Re-issue and apply less than balance.
    client.issue_credit(&sub, &300, &reason, &None);
    let partial = client.apply_credit(&sub, &42, &100);
    assert_eq!(partial.applied, 100);
    assert_eq!(partial.remaining_due, 0);
    assert_eq!(client.get_credit_balance(&sub), 200);
}

#[test]
fn balance_never_goes_negative() {
    let (env, client, _admin) = setup();
    let sub = Address::generate(&env);
    // No credit issued; applying yields zero and a non-negative balance.
    let applied = client.apply_credit(&sub, &1, &1000);
    assert_eq!(applied.applied, 0);
    assert_eq!(applied.balance_after, 0);
    assert_eq!(client.get_credit_balance(&sub), 0);
}

#[test]
fn transfers_credit_between_accounts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let reason = String::from_str(&env, "gift");
    client.issue_credit(&alice, &400, &reason, &None);

    client.transfer_credit(&alice, &bob, &150, &reason);
    assert_eq!(client.get_credit_balance(&alice), 250);
    assert_eq!(client.get_credit_balance(&bob), 150);
}

#[test]
fn rejects_overdraw_transfer() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let reason = String::from_str(&env, "gift");
    client.issue_credit(&alice, &100, &reason, &None);
    let res = client.try_transfer_credit(&alice, &bob, &200, &reason);
    assert_eq!(res, Err(Ok(CreditError::InsufficientCredit)));
}

#[test]
fn expires_credit_after_deadline() {
    let (env, client, _admin) = setup();
    let sub = Address::generate(&env);
    let reason = String::from_str(&env, "promo");
    set_time(&env, 1_000);
    // Expires at t=2_000.
    client.issue_credit(&sub, &500, &reason, &Some(2_000));
    assert_eq!(client.get_credit_balance(&sub), 500);

    // Past expiry the available balance is zero.
    set_time(&env, 2_500);
    assert_eq!(client.get_credit_balance(&sub), 0);

    // Realizing expiry records the loss and reduces the stored balance.
    let expired = client.expire_credits(&sub);
    assert_eq!(expired, 500);
    let account = client.get_credit_account(&sub);
    assert_eq!(account.balance, 0);
    // Issue + Expire transactions present.
    assert_eq!(account.transactions.len(), 2);
}

#[test]
fn expiration_policy_drives_default_expiry() {
    let (env, client, _admin) = setup();
    let sub = Address::generate(&env);
    let reason = String::from_str(&env, "promo");
    set_time(&env, 1_000);
    client.set_expiration_policy(&sub, &ExpirationPolicy::AfterSecs(100));
    client.issue_credit(&sub, &200, &reason, &None);

    set_time(&env, 1_050);
    assert_eq!(client.get_credit_balance(&sub), 200);
    set_time(&env, 1_200); // > 1_000 + 100
    assert_eq!(client.get_credit_balance(&sub), 0);
}
