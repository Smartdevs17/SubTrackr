#![no_std]

mod auth;
mod ratelimit;
#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Vec};
use subtrackr_types::{
    ApiKey, ApiKeyAuditEntry, ApiKeyConfig, ApiKeyId, RateLimitStatus, TimeRange, UsageReport,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ApiKey(u64),
    ApiKeyCount,
    OwnerKeys(Address),
    KeysByOwner,
    ApiKeyAuditEntry(u64),
    ApiKeyAuditCount,
    RateLimitMinute(u64, u64),
    RateLimitHour(u64, u64),
    RateLimitDay(u64, u64),
}

#[contract]
pub struct SubTrackrApi;

#[contractimpl]
impl SubTrackrApi {
    // ── API Key Lifecycle ──

    /// Create a new API key. Returns `(key_id, raw_key_bytes)`.
    /// The raw key is returned exactly once and must be stored off-chain.
    pub fn create_api_key(
        env: Env,
        owner: Address,
        config: ApiKeyConfig,
    ) -> (ApiKeyId, Bytes) {
        owner.require_auth();
        let now = env.ledger().timestamp();
        auth::create_api_key(&env, owner, config, now)
    }

    /// Revoke an API key by id. Only the owner can revoke.
    pub fn revoke_api_key(env: Env, caller: Address, key_id: ApiKeyId) {
        caller.require_auth();
        let now = env.ledger().timestamp();
        auth::revoke_api_key(&env, caller, key_id, now);
    }

    /// Rotate an API key. Returns new raw key bytes.
    pub fn rotate_api_key(env: Env, caller: Address, key_id: ApiKeyId) -> Bytes {
        caller.require_auth();
        let now = env.ledger().timestamp();
        auth::rotate_api_key(&env, caller, key_id, now)
    }

    /// Validate an API key by comparing the provided key_hash against
    /// the stored hash. Also checks revocation and expiry.
    /// Updates `last_used_at` if valid.
    pub fn validate_api_key(env: Env, key_id: ApiKeyId, key_hash: BytesN<32>) -> bool {
        let now = env.ledger().timestamp();
        let valid = auth::validate_api_key(&env, key_id, key_hash, now);
        if valid {
            if let Some(mut key) = auth::get_api_key(&env, key_id) {
                key.last_used_at = now;
                env.storage().instance().set(&DataKey::ApiKey(key_id), &key);
            }
        }
        valid
    }

    /// Get details for a single API key.
    pub fn get_api_key(env: Env, key_id: ApiKeyId) -> Option<ApiKey> {
        auth::get_api_key(&env, key_id)
    }

    /// List all API keys owned by an address.
    pub fn list_api_keys(env: Env, owner: Address) -> Vec<ApiKey> {
        auth::list_api_keys_by_owner(&env, owner)
    }

    /// Get audit trail for an API key.
    pub fn get_api_key_audit(env: Env, key_id: ApiKeyId) -> Vec<ApiKeyAuditEntry> {
        auth::get_api_key_audit(&env, key_id)
    }

    // ── Rate Limiting ──

    /// Check whether a request should be rate-limited for the given key.
    /// Increments the request counter atomically.
    pub fn check_rate_limit(env: Env, key_id: ApiKeyId, key_hash: BytesN<32>) -> RateLimitStatus {
        let now = env.ledger().timestamp();
        if !auth::validate_api_key(&env, key_id, key_hash, now) {
            return RateLimitStatus {
                is_allowed: false,
                remaining: 0,
                reset_at: 0,
                retry_after: 0,
            };
        }
        let key = auth::get_api_key(&env, key_id).expect("Key exists after validation");
        ratelimit::check_rate_limit(&env, &key, now)
    }

    /// Get usage report for a key over a time period.
    pub fn get_api_usage(env: Env, key_id: ApiKeyId, period: TimeRange) -> UsageReport {
        ratelimit::get_api_usage(&env, key_id, period)
    }

    /// Calculate usage-based charges for a key over a period.
    pub fn calculate_api_charge(env: Env, key_id: ApiKeyId, period: TimeRange) -> i128 {
        let key = auth::get_api_key(&env, key_id).expect("ApiKey not found");
        ratelimit::calculate_api_charge(&env, &key, period)
    }
}
