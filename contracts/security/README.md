# SubTrackr Security — PII Encryption at Rest

Encrypts subscriber PII for GDPR compliance, on-chain (`subtrackr-security`
contract) and on the client (`app/services/encryptionService.ts`). Both sides
use the **same** algorithm so ciphertext is interoperable.

## Algorithm

Soroban exposes no symmetric block cipher, only `sha256`. We use a hash-based
stream cipher in CTR mode plus an encrypt-and-MAC integrity tag:

- **Cipher** — for 32-byte block `i`: `keystream_i = SHA-256(key || nonce ||
  counter_i_be)`, XOR-ed with the data. XOR is symmetric, so the same routine
  encrypts and decrypts.
- **Integrity** — `mac = SHA-256(key || nonce || plaintext)`, recomputed and
  compared on decrypt to detect tampering or decryption under the wrong key.
- **Nonce** — a fresh 32-byte nonce per record (CSPRNG on the client; a
  monotonic counter mixed with ledger context in the contract). A `(key, nonce)`
  pair is never reused.

## PII fields

The fields treated as personal data (`PII_FIELDS`): `email`, `fullName`,
`phone`, `billingAddress`, `taxId`, `walletAddress`, `ipAddress`. Encrypt only
these; leave non-PII fields in the clear for indexing/queries.

## Keys, rotation & management

- Keys are **versioned**. `initialize` creates version 1.
- `rotate_key` deactivates the current version (no longer used for new
  encryptions) and installs a new active version. **Old versions are retained**
  so historical records stay decryptable. Each `EncryptedData` envelope records
  its `key_version`, so the right key is always selected on decrypt.
- `export_encrypted` / `exportEncrypted` re-encrypt a record under the current
  key — used for GDPR data export and for migrating ciphertext after rotation.

## Access control

Encryption and decryption are gated. On-chain: the admin plus addresses granted
via `grant_access`. On the client: an injectable `AccessController` predicate
(wire it to RBAC in the app). Decryption verifies the MAC before returning data.

## Edge cases

- **Key loss** — if a key version's material is lost, records encrypted under
  it are unrecoverable by design (no backdoor). Operationally, back up key
  material in a KMS/HSM and rotate rather than discard; never delete a retained
  key version that still protects live data.
- **Performance** — SHA-256 hashing scales linearly with payload size (one hash
  per 32-byte block plus one MAC hash). Encrypt only PII fields, keep payloads
  small, and prefer the client to encrypt before submitting to chain so the
  contract mostly stores opaque ciphertext.
- **Tamper / wrong key** — surfaced as a MAC verification failure (panic on
  chain, thrown error on client) rather than returning garbage plaintext.
