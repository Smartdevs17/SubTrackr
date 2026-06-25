#![cfg(test)]
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Bytes, BytesN, Env};
use subtrackr_types::{ApiKeyConfig, ApiKeyStatus, RateLimitConfig, TimeRange, UsageTier};

use crate::{SubTrackrApi, SubTrackrApiClient};

fn setup() -> (Env, SubTrackrApiClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubTrackrApi);
    let client = SubTrackrApiClient::new(&env, &id);
    let owner = Address::generate(&env);
    (env, client, owner)
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

fn default_config(env: &Env) -> ApiKeyConfig {
    ApiKeyConfig {
        name: soroban_sdk::String::from_str(env, "test-key"),
        rate_limit: RateLimitConfig {
            requests_per_minute: 5,
            requests_per_hour: 20,
            requests_per_day: 100,
            burst_limit: 3,
        },
        usage_tier: UsageTier::Free,
        expires_at: 0,
    }
}

fn hash_bytes(env: &Env, raw: &Bytes) -> BytesN<32> {
    env.crypto().sha256(raw).into()
}

fn make_bytes(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, s.as_bytes())
}

// ── API Key Lifecycle Tests ──

#[test]
fn test_create_api_key() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    assert!(key_id >= 1, "Key id should be >= 1");
    assert!(!raw_key.is_empty(), "Raw key bytes should not be empty");

    let stored = client.get_api_key(&key_id).unwrap();
    assert_eq!(stored.id, key_id);
    assert_eq!(stored.status, ApiKeyStatus::Active);
    assert_eq!(stored.created_at, 1_000_000);
    assert_eq!(stored.owner, owner);
    assert_eq!(stored.key_hash, hash_bytes(&env, &raw_key));
}

#[test]
fn test_revoke_api_key() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, _) = client.create_api_key(&owner, &default_config(&env));
    assert_eq!(
        client.get_api_key(&key_id).unwrap().status,
        ApiKeyStatus::Active
    );

    set_time(&env, 1_000_100);
    client.revoke_api_key(&owner, &key_id);

    let key = client.get_api_key(&key_id).unwrap();
    assert_eq!(key.status, ApiKeyStatus::Revoked);
    assert_eq!(key.revoked_at, 1_000_100);
}

#[test]
fn test_rotate_api_key() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, original_raw) = client.create_api_key(&owner, &default_config(&env));
    let original_hash = hash_bytes(&env, &original_raw);

    set_time(&env, 1_001_000);
    let new_raw = client.rotate_api_key(&owner, &key_id);
    assert_ne!(new_raw, original_raw, "New raw key should differ from old");

    let valid_old = client.validate_api_key(&key_id, &original_hash);
    assert!(!valid_old, "Old key hash should be invalid after rotation");

    let new_hash = hash_bytes(&env, &new_raw);
    let valid_new = client.validate_api_key(&key_id, &new_hash);
    assert!(valid_new, "New key hash should be valid after rotation");
}

#[test]
fn test_validate_api_key_active() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    assert!(client.validate_api_key(&key_id, &key_hash));

    let wrong_hash = hash_bytes(&env, &make_bytes(&env, "wrong-key"));
    assert!(!client.validate_api_key(&key_id, &wrong_hash));
}

#[test]
fn test_validate_revoked_key_fails() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    client.revoke_api_key(&owner, &key_id);
    assert!(!client.validate_api_key(&key_id, &key_hash));
}

#[test]
fn test_validate_expired_key_fails() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let mut config = default_config(&env);
    config.expires_at = 1_000_500;

    let (key_id, raw_key) = client.create_api_key(&owner, &config);
    let key_hash = hash_bytes(&env, &raw_key);

    set_time(&env, 1_000_400);
    assert!(client.validate_api_key(&key_id, &key_hash));

    set_time(&env, 1_000_600);
    assert!(!client.validate_api_key(&key_id, &key_hash));
}

#[test]
fn test_list_api_keys_by_owner() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (id1, _) = client.create_api_key(&owner, &default_config(&env));
    let (id2, _) = client.create_api_key(&owner, &default_config(&env));

    let keys = client.list_api_keys(&owner);
    assert_eq!(keys.len(), 2);

    let mut found1 = false;
    let mut found2 = false;
    for k in keys.iter() {
        if k.id == id1 {
            found1 = true;
        }
        if k.id == id2 {
            found2 = true;
        }
    }
    assert!(found1);
    assert!(found2);
}

#[test]
fn test_audit_trail() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, _) = client.create_api_key(&owner, &default_config(&env));

    set_time(&env, 1_001_000);
    client.rotate_api_key(&owner, &key_id);

    set_time(&env, 1_002_000);
    client.revoke_api_key(&owner, &key_id);

    let audit = client.get_api_key_audit(&key_id);
    assert_eq!(
        audit.len(),
        2,
        "Should have rotate and revoke audit entries"
    );
    assert_eq!(
        audit.get(0).unwrap().action,
        soroban_sdk::String::from_str(&env, "rotated")
    );
    assert_eq!(
        audit.get(1).unwrap().action,
        soroban_sdk::String::from_str(&env, "revoked")
    );
}

#[test]
fn test_validate_updates_last_used() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    assert_eq!(client.get_api_key(&key_id).unwrap().last_used_at, 0);

    set_time(&env, 1_001_000);
    client.validate_api_key(&key_id, &key_hash);

    assert_eq!(client.get_api_key(&key_id).unwrap().last_used_at, 1_001_000);
}

// ── Rate Limiting Tests ──

#[test]
fn test_rate_limit_per_minute() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    for _ in 0..5 {
        let status = client.check_rate_limit(&key_id, &key_hash);
        assert!(status.is_allowed, "Request should be allowed within limit");
    }

    let status = client.check_rate_limit(&key_id, &key_hash);
    assert!(
        !status.is_allowed,
        "Request should be blocked past per-minute limit"
    );
    assert_eq!(status.remaining, 0);
}

#[test]
fn test_rate_limit_reset_after_window() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    for _ in 0..5 {
        client.check_rate_limit(&key_id, &key_hash);
    }
    let blocked = client.check_rate_limit(&key_id, &key_hash);
    assert!(!blocked.is_allowed);

    set_time(&env, 1_000_060);

    let status = client.check_rate_limit(&key_id, &key_hash);
    assert!(status.is_allowed, "Should reset after window passes");
}

#[test]
fn test_rate_limit_per_hour() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    for m in 0..3 {
        for _ in 0..5 {
            client.check_rate_limit(&key_id, &key_hash);
        }
        set_time(&env, 1_000_000 + (m as u64 + 1) * 60);
    }

    for _ in 0..5 {
        client.check_rate_limit(&key_id, &key_hash);
    }
    let status = client.check_rate_limit(&key_id, &key_hash);
    assert!(!status.is_allowed, "Should be blocked by hourly limit");
}

#[test]
fn test_burst_limit() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    for i in 0..5 {
        let status = client.check_rate_limit(&key_id, &key_hash);
        assert!(status.is_allowed, "Request {} should be allowed", i + 1);
    }
}

#[test]
fn test_usage_tracking_and_report() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, raw_key) = client.create_api_key(&owner, &default_config(&env));
    let key_hash = hash_bytes(&env, &raw_key);

    for _ in 0..3 {
        client.check_rate_limit(&key_id, &key_hash);
    }

    set_time(&env, 1_000_100);
    let period = TimeRange {
        start: 1_000_000,
        end: 1_000_200,
    };
    let report = client.get_api_usage(&key_id, &period);
    assert_eq!(report.total_requests, 3);
    assert_eq!(report.key_id, key_id);
}

#[test]
fn test_calculate_api_charge() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let mut config = default_config(&env);
    config.rate_limit = RateLimitConfig {
        requests_per_minute: 10_000,
        requests_per_hour: 100_000,
        requests_per_day: 1_000_000,
        burst_limit: 10_000,
    };
    config.usage_tier = UsageTier::Basic;

    let (key_id, raw_key) = client.create_api_key(&owner, &config);
    let key_hash = hash_bytes(&env, &raw_key);

    for _ in 0..10 {
        client.check_rate_limit(&key_id, &key_hash);
    }

    let period = TimeRange {
        start: 1_000_000,
        end: 1_001_000,
    };
    let charge = client.calculate_api_charge(&key_id, &period);
    // 10 requests - 1000 free = 0 billable
    assert_eq!(charge, 0);
}

#[test]
fn test_invalid_key_check_rate_limit() {
    let (env, client, owner) = setup();
    set_time(&env, 1_000_000);

    let (key_id, _raw_key) = client.create_api_key(&owner, &default_config(&env));
    let wrong_hash = hash_bytes(&env, &make_bytes(&env, "invalid-key"));
    let status = client.check_rate_limit(&key_id, &wrong_hash);
    assert!(!status.is_allowed);
    assert_eq!(status.remaining, 0);
}
