use soroban_sdk::{Address, Bytes, BytesN, Env, String, Vec};
use subtrackr_types::{ApiKey, ApiKeyAuditEntry, ApiKeyConfig, ApiKeyId, ApiKeyStatus};

use crate::DataKey;

const MAX_KEYS_PER_OWNER: u32 = 10;

pub fn generate_key_id(env: &Env) -> ApiKeyId {
    let mut count: ApiKeyId = env
        .storage()
        .instance()
        .get(&DataKey::ApiKeyCount)
        .unwrap_or(0);
    count += 1;
    env.storage().instance().set(&DataKey::ApiKeyCount, &count);
    count
}

fn hash_key_bytes(env: &Env, raw: &Bytes) -> BytesN<32> {
    env.crypto().sha256(raw).into()
}

fn generate_raw_key_bytes(env: &Env) -> Bytes {
    let mut raw = Bytes::new(env);
    raw.push_back(0x73); // 's'
    raw.push_back(0x6b); // 'k'
    raw.push_back(0x5f); // '_'
    for _ in 0..32 {
        let byte: u8 = (env.prng().gen::<u64>() % 256) as u8;
        raw.push_back(byte);
    }
    raw
}

pub fn create_api_key(
    env: &Env,
    owner: Address,
    config: ApiKeyConfig,
    now: u64,
) -> (ApiKeyId, Bytes) {
    let key_id = generate_key_id(env);

    let existing: Option<Vec<Address>> = env.storage().instance().get(&DataKey::KeysByOwner);
    let mut owners: Vec<Address> = existing.unwrap_or(Vec::new(env));
    let mut owner_found = false;
    for o in owners.iter() {
        if o == owner {
            owner_found = true;
            break;
        }
    }
    if !owner_found {
        owners.push_back(owner.clone());
        env.storage().instance().set(&DataKey::KeysByOwner, &owners);
    }

    let owner_keys: Vec<ApiKeyId> = env
        .storage()
        .instance()
        .get(&DataKey::OwnerKeys(owner.clone()))
        .unwrap_or(Vec::new(env));
    assert!(
        (owner_keys.len() as u32) < MAX_KEYS_PER_OWNER,
        "Max keys per owner reached"
    );
    let mut new_owner_keys = owner_keys;
    new_owner_keys.push_back(key_id);
    env.storage()
        .instance()
        .set(&DataKey::OwnerKeys(owner.clone()), &new_owner_keys);

    let raw_key = generate_raw_key_bytes(env);
    let key_hash = hash_key_bytes(env, &raw_key);

    let api_key = ApiKey {
        id: key_id,
        owner: owner.clone(),
        key_hash,
        name: config.name,
        rate_limit: config.rate_limit,
        usage_tier: config.usage_tier,
        status: ApiKeyStatus::Active,
        created_at: now,
        expires_at: config.expires_at,
        last_used_at: 0,
        revoked_at: 0,
    };
    env.storage()
        .instance()
        .set(&DataKey::ApiKey(key_id), &api_key);

    (key_id, raw_key)
}

pub fn get_api_key(env: &Env, key_id: ApiKeyId) -> Option<ApiKey> {
    env.storage().instance().get(&DataKey::ApiKey(key_id))
}

pub fn revoke_api_key(env: &Env, caller: Address, key_id: ApiKeyId, now: u64) {
    let mut key: ApiKey = env
        .storage()
        .instance()
        .get(&DataKey::ApiKey(key_id))
        .expect("ApiKey not found");
    assert!(key.owner == caller, "Only owner can revoke");
    assert!(key.status == ApiKeyStatus::Active, "Key is not active");

    key.status = ApiKeyStatus::Revoked;
    key.revoked_at = now;
    env.storage()
        .instance()
        .set(&DataKey::ApiKey(key_id), &key);

    log_audit(env, key_id, String::from_str(env, "revoked"), caller, now);
}

pub fn rotate_api_key(
    env: &Env,
    caller: Address,
    key_id: ApiKeyId,
    now: u64,
) -> Bytes {
    let mut key: ApiKey = env
        .storage()
        .instance()
        .get(&DataKey::ApiKey(key_id))
        .expect("ApiKey not found");
    assert!(key.owner == caller, "Only owner can rotate");
    assert!(
        key.status == ApiKeyStatus::Active,
        "Cannot rotate revoked key"
    );

    let new_raw = generate_raw_key_bytes(env);
    let new_hash = hash_key_bytes(env, &new_raw);
    key.key_hash = new_hash;
    key.last_used_at = 0;
    env.storage()
        .instance()
        .set(&DataKey::ApiKey(key_id), &key);

    log_audit(env, key_id, String::from_str(env, "rotated"), caller, now);
    new_raw
}

pub fn validate_api_key(env: &Env, key_id: ApiKeyId, key_hash: BytesN<32>, now: u64) -> bool {
    let key: Option<ApiKey> = env.storage().instance().get(&DataKey::ApiKey(key_id));
    match key {
        None => false,
        Some(k) => {
            if k.key_hash != key_hash {
                return false;
            }
            if k.status == ApiKeyStatus::Revoked {
                return false;
            }
            if k.expires_at != 0 && now > k.expires_at {
                return false;
            }
            true
        }
    }
}

pub fn list_api_keys_by_owner(env: &Env, owner: Address) -> Vec<ApiKey> {
    let key_ids: Vec<ApiKeyId> = env
        .storage()
        .instance()
        .get(&DataKey::OwnerKeys(owner))
        .unwrap_or(Vec::new(env));
    let mut keys: Vec<ApiKey> = Vec::new(env);
    for id in key_ids.iter() {
        if let Some(k) = get_api_key(env, id) {
            keys.push_back(k);
        }
    }
    keys
}

pub fn get_api_key_audit(env: &Env, key_id: ApiKeyId) -> Vec<ApiKeyAuditEntry> {
    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ApiKeyAuditCount)
        .unwrap_or(0);
    let mut entries: Vec<ApiKeyAuditEntry> = Vec::new(env);
    for i in 1..=count {
        let entry: Option<ApiKeyAuditEntry> =
            env.storage().instance().get(&DataKey::ApiKeyAuditEntry(i));
        if let Some(e) = entry {
            if e.key_id == key_id {
                entries.push_back(e);
            }
        }
    }
    entries
}

fn log_audit(
    env: &Env,
    key_id: ApiKeyId,
    action: String,
    changed_by: Address,
    now: u64,
) {
    let mut count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ApiKeyAuditCount)
        .unwrap_or(0);
    count += 1;
    let entry = ApiKeyAuditEntry {
        id: count,
        key_id,
        action,
        changed_by,
        timestamp: now,
    };
    env.storage()
        .instance()
        .set(&DataKey::ApiKeyAuditEntry(count), &entry);
    env.storage()
        .instance()
        .set(&DataKey::ApiKeyAuditCount, &count);
}
