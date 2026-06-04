#![no_std]
//! SubTrackr Security contract.
//!
//! Provides encryption at rest for subscriber PII (GDPR compliance), with
//! versioned symmetric keys, key rotation, an access-control list for who may
//! encrypt/decrypt, and re-encryption support for data export.
//!
//! Key lifetime model:
//!   * `initialize` creates key version 1 and marks the caller as admin.
//!   * `rotate_key` deactivates the current key (so it is no longer used for
//!     *new* encryptions) and installs a new active version. Old key versions
//!     are retained so previously encrypted records remain decryptable.
//!   * Every `EncryptedData` envelope records the `key_version` used, so the
//!     contract always selects the right key on decryption.

mod encryption;

use encryption::{compute_mac, xor_crypt, DataKey, EncryptedData, EncryptionKey};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Symbol};

#[contract]
pub struct SubTrackrSecurity;

#[contractimpl]
impl SubTrackrSecurity {
    // ── Lifecycle ────────────────────────────────────────────────────────────

    /// Initialize the contract with an admin and the first encryption key.
    /// The admin is implicitly authorized to encrypt and decrypt.
    pub fn initialize(env: Env, admin: Address, initial_key: BytesN<32>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);

        let key = EncryptionKey {
            version: 1,
            key_material: initial_key,
            created_at: env.ledger().timestamp(),
            active: true,
        };
        env.storage().persistent().set(&DataKey::Key(1), &key);
        env.storage()
            .instance()
            .set(&DataKey::CurrentKeyVersion, &1u32);
        env.storage().instance().set(&DataKey::RotationCount, &0u64);
        env.storage().instance().set(&DataKey::NonceCounter, &0u64);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    fn require_admin(env: &Env) {
        Self::admin(env).require_auth();
    }

    /// Authorized = admin, or an address explicitly granted access.
    fn is_authorized_internal(env: &Env, account: &Address) -> bool {
        if *account == Self::admin(env) {
            return true;
        }
        env.storage()
            .persistent()
            .get(&DataKey::Authorized(account.clone()))
            .unwrap_or(false)
    }

    fn require_authorized(env: &Env, account: &Address) {
        assert!(
            Self::is_authorized_internal(env, account),
            "Unauthorized: account may not access PII encryption"
        );
    }

    fn load_key(env: &Env, version: u32) -> EncryptionKey {
        env.storage()
            .persistent()
            .get(&DataKey::Key(version))
            .expect("Encryption key version not found")
    }

    /// Derive a fresh, unique nonce from a monotonic counter mixed with the
    /// active key material and ledger context. Never reuses a nonce per key.
    fn next_nonce(env: &Env, key_material: &BytesN<32>) -> BytesN<32> {
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NonceCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::NonceCounter, &counter);

        let mut buf = Bytes::from_array(env, &key_material.to_array());
        buf.extend_from_array(&counter.to_be_bytes());
        buf.extend_from_array(&env.ledger().timestamp().to_be_bytes());
        buf.extend_from_array(&env.ledger().sequence().to_be_bytes());
        env.crypto().sha256(&buf).to_bytes()
    }

    // ── Core API ──────────────────────────────────────────────────────────────

    /// Encrypt PII under the current active key. Caller must be authorized.
    pub fn encrypt_data(env: Env, caller: Address, data: Bytes) -> EncryptedData {
        caller.require_auth();
        Self::require_authorized(&env, &caller);

        let version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentKeyVersion)
            .expect("Not initialized");
        let key = Self::load_key(&env, version);
        assert!(key.active, "Current key is not active");

        let nonce = Self::next_nonce(&env, &key.key_material);
        let ciphertext = xor_crypt(&env, &key.key_material, &nonce, &data);
        let mac = compute_mac(&env, &key.key_material, &nonce, &data);

        EncryptedData {
            key_version: version,
            nonce,
            ciphertext,
            mac,
        }
    }

    /// Decrypt PII. Caller must be authorized. Verifies the integrity MAC and
    /// panics on tamper / wrong key.
    pub fn decrypt_data(env: Env, caller: Address, encrypted: EncryptedData) -> Bytes {
        caller.require_auth();
        Self::require_authorized(&env, &caller);

        let key = Self::load_key(&env, encrypted.key_version);
        let plaintext = xor_crypt(&env, &key.key_material, &encrypted.nonce, &encrypted.ciphertext);
        let mac = compute_mac(&env, &key.key_material, &encrypted.nonce, &plaintext);
        assert!(
            mac == encrypted.mac,
            "MAC verification failed: data tampered or wrong key"
        );
        plaintext
    }

    // ── Key management & rotation ──────────────────────────────────────────────

    /// Rotate the active encryption key. The previous key is deactivated for
    /// new encryptions but retained for decrypting historical records. Returns
    /// the new key version. Admin only.
    pub fn rotate_key(env: Env, new_key: BytesN<32>) -> u32 {
        Self::require_admin(&env);

        let current: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentKeyVersion)
            .expect("Not initialized");

        let mut old = Self::load_key(&env, current);
        old.active = false;
        env.storage().persistent().set(&DataKey::Key(current), &old);

        let new_version = current + 1;
        let key = EncryptionKey {
            version: new_version,
            key_material: new_key,
            created_at: env.ledger().timestamp(),
            active: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Key(new_version), &key);
        env.storage()
            .instance()
            .set(&DataKey::CurrentKeyVersion, &new_version);

        let rotations: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RotationCount)
            .unwrap_or(0)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::RotationCount, &rotations);

        env.events()
            .publish((Symbol::new(&env, "key_rotated"),), (current, new_version));
        new_version
    }

    /// Current active key version.
    pub fn current_key_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CurrentKeyVersion)
            .expect("Not initialized")
    }

    /// Number of rotations performed (audit metric).
    pub fn rotation_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::RotationCount)
            .unwrap_or(0)
    }

    // ── Access control ──────────────────────────────────────────────────────────

    /// Grant an account permission to encrypt/decrypt PII. Admin only.
    pub fn grant_access(env: Env, account: Address) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Authorized(account.clone()), &true);
        env.events()
            .publish((Symbol::new(&env, "access_granted"),), account);
    }

    /// Revoke an account's PII encryption access. Admin only.
    pub fn revoke_access(env: Env, account: Address) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::Authorized(account.clone()));
        env.events()
            .publish((Symbol::new(&env, "access_revoked"),), account);
    }

    /// Whether `account` may access PII encryption (admin or granted).
    pub fn is_authorized(env: Env, account: Address) -> bool {
        Self::is_authorized_internal(&env, &account)
    }

    // ── Data export ──────────────────────────────────────────────────────────────

    /// Re-encrypt an existing record under the current active key. Used for
    /// secure data export and for migrating ciphertext onto a rotated key.
    /// Caller must be authorized. The plaintext never leaves the contract.
    pub fn export_encrypted(env: Env, caller: Address, encrypted: EncryptedData) -> EncryptedData {
        caller.require_auth();
        Self::require_authorized(&env, &caller);

        // Decrypt under the original key version (verifying integrity)...
        let old_key = Self::load_key(&env, encrypted.key_version);
        let plaintext =
            xor_crypt(&env, &old_key.key_material, &encrypted.nonce, &encrypted.ciphertext);
        let check = compute_mac(&env, &old_key.key_material, &encrypted.nonce, &plaintext);
        assert!(
            check == encrypted.mac,
            "MAC verification failed: data tampered or wrong key"
        );

        // ...and re-encrypt under the current active key with a fresh nonce.
        let version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentKeyVersion)
            .expect("Not initialized");
        let key = Self::load_key(&env, version);
        let nonce = Self::next_nonce(&env, &key.key_material);
        let ciphertext = xor_crypt(&env, &key.key_material, &nonce, &plaintext);
        let mac = compute_mac(&env, &key.key_material, &nonce, &plaintext);

        EncryptedData {
            key_version: version,
            nonce,
            ciphertext,
            mac,
        }
    }
}
