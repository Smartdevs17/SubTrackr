//! Encryption primitives and types for PII encryption at rest.
//!
//! Soroban's host does not expose a symmetric block cipher (no AES), but it
//! does expose `sha256`.  We therefore implement a **hash-based stream cipher
//! in counter (CTR) mode**: for each 32-byte block `i` of the message the
//! keystream block is `SHA-256(key || nonce || counter_i)`, which is XOR-ed
//! with the plaintext.  Because XOR is symmetric, the exact same routine both
//! encrypts and decrypts.
//!
//! Integrity is provided by an encrypt-and-MAC tag, `SHA-256(key || nonce ||
//! plaintext)`, recomputed and compared on decryption to detect tampering or
//! decryption under the wrong key version.
//!
//! Confidentiality depends on each `(key, nonce)` pair being unique — never
//! reuse a nonce with the same key.  `next_nonce` in `lib.rs` derives a fresh
//! nonce per encryption from a monotonic counter mixed with ledger context.

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env};

/// Storage keys for the security contract.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract administrator (manages keys and the access list).
    Admin,
    /// Version number of the currently active encryption key.
    CurrentKeyVersion,
    /// Stored `EncryptionKey` material keyed by version. Old versions are
    /// retained (but deactivated) so previously encrypted data stays readable.
    Key(u32),
    /// Whether an address is authorized to encrypt/decrypt PII.
    Authorized(Address),
    /// Total number of key rotations performed (audit).
    RotationCount,
    /// Monotonic counter used to derive unique per-record nonces.
    NonceCounter,
}

/// A versioned symmetric encryption key.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EncryptionKey {
    /// Monotonic version. Version 1 is created at `initialize`.
    pub version: u32,
    /// 32-byte symmetric key material.
    pub key_material: BytesN<32>,
    /// Ledger timestamp when this key version was created.
    pub created_at: u64,
    /// Whether this key may be used for *new* encryptions. Rotated-out keys
    /// are set to `false` but kept so old ciphertext can still be decrypted.
    pub active: bool,
}

/// Self-describing ciphertext envelope.
///
/// It carries the key version and per-record nonce so the data can always be
/// decrypted later, even after one or more key rotations.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EncryptedData {
    /// Version of the key used to encrypt this record.
    pub key_version: u32,
    /// Per-record nonce. Unique for every encryption under a given key.
    pub nonce: BytesN<32>,
    /// The XOR-keystream ciphertext (same length as the plaintext).
    pub ciphertext: Bytes,
    /// `SHA-256(key || nonce || plaintext)` integrity tag.
    pub mac: BytesN<32>,
}

/// Derive the keystream block for counter `counter`:
/// `SHA-256(key || nonce || counter_be)`.
fn keystream_block(env: &Env, key: &BytesN<32>, nonce: &BytesN<32>, counter: u32) -> [u8; 32] {
    let mut buf = Bytes::from_array(env, &key.to_array());
    buf.append(&Bytes::from_array(env, &nonce.to_array()));
    buf.extend_from_array(&counter.to_be_bytes());
    env.crypto().sha256(&buf).to_array()
}

/// Encrypt or decrypt `input` with the hash-CTR stream cipher. Symmetric: the
/// same call both encrypts (plaintext -> ciphertext) and decrypts.
pub fn xor_crypt(env: &Env, key: &BytesN<32>, nonce: &BytesN<32>, input: &Bytes) -> Bytes {
    let mut out = Bytes::new(env);
    let len = input.len();
    let mut block_index: u32 = 0;
    let mut ks = keystream_block(env, key, nonce, block_index);

    let mut i: u32 = 0;
    while i < len {
        let pos = i % 32;
        if i != 0 && pos == 0 {
            block_index += 1;
            ks = keystream_block(env, key, nonce, block_index);
        }
        let b = input.get(i).unwrap_or(0);
        out.push_back(b ^ ks[pos as usize]);
        i += 1;
    }
    out
}

/// Compute the integrity MAC `SHA-256(key || nonce || plaintext)`.
pub fn compute_mac(
    env: &Env,
    key: &BytesN<32>,
    nonce: &BytesN<32>,
    plaintext: &Bytes,
) -> BytesN<32> {
    let mut buf = Bytes::from_array(env, &key.to_array());
    buf.append(&Bytes::from_array(env, &nonce.to_array()));
    buf.append(plaintext);
    env.crypto().sha256(&buf).to_bytes()
}
