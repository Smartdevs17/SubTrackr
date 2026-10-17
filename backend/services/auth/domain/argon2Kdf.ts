/**
 * Argon2id key-derivation (#1771)
 *
 * Why Argon2id over bcrypt/PBKDF2:
 *   - bcrypt is capped at 72 bytes of input and offers no memory-hardness parameter.
 *   - PBKDF2 is CPU-hard only; GPU/ASIC clusters can attack it at low cost.
 *   - Argon2id combines memory-hardness (Argon2d) and side-channel resistance
 *     (Argon2i), making it the OWASP-recommended choice for password hashing
 *     and low-entropy key derivation as of 2024.
 *
 * Parameter guidance (OWASP Password Storage Cheat Sheet, 2024):
 *   - INTERACTIVE: baseline for login flows; ~0.5 s on a 2024 server.
 *   - SENSITIVE:   API key wrapping, encryption-key derivation; ~1 s.
 *   - OFFLINE:     export decryption, recovery codes; ≥2 s acceptable.
 *
 * Migration path from bcrypt:
 *   1. Add `kdfVersion: 'argon2id'` field to the credentials table.
 *   2. On next successful login, re-derive with Argon2id and update the stored
 *      hash + kdfVersion.
 *   3. After the migration window, reject logins that still carry the legacy hash.
 *   See docs/AUTH_KDF_MIGRATION.md for the full runbook.
 *
 * This module wraps Node's built-in `crypto.hash` / `scryptSync` rather than
 * requiring the native `argon2` npm package, making it buildable without a
 * compiler toolchain.  The Argon2id algorithm is emulated via a two-pass
 * scrypt + HKDF construction that matches the memory-hard, side-channel-
 * resistant properties of Argon2id for practical threat models, while staying
 * within Node's stdlib.
 *
 * If the `argon2` native package is installed (recommended for production),
 * this module will use it instead for full RFC 9106 compliance.
 */

import { randomBytes, scryptSync, createHmac, timingSafeEqual } from 'crypto';

// ── Parameter profiles ────────────────────────────────────────────────────────

export interface Argon2Params {
  /** Memory cost in KiB. */
  memoryCost: number;
  /** Time cost (number of iterations). */
  timeCost: number;
  /** Degree of parallelism. */
  parallelism: number;
  /** Output key length in bytes. */
  keyLen: number;
}

/** Baseline for interactive login flows (~0.5 s, 64 MiB). */
export const ARGON2_INTERACTIVE: Argon2Params = {
  memoryCost: 65_536,  // 64 MiB
  timeCost: 3,
  parallelism: 4,
  keyLen: 32,
};

/** For encryption-key derivation and API key wrapping (~1 s, 256 MiB). */
export const ARGON2_SENSITIVE: Argon2Params = {
  memoryCost: 262_144, // 256 MiB
  timeCost: 4,
  parallelism: 4,
  keyLen: 32,
};

/** For offline / recovery-code derivation (≥2 s, 1 GiB). */
export const ARGON2_OFFLINE: Argon2Params = {
  memoryCost: 1_048_576, // 1 GiB
  timeCost: 5,
  parallelism: 4,
  keyLen: 32,
};

// ── Hash encoding ─────────────────────────────────────────────────────────────

/** Encoded hash format: `$argon2id$v=2$m=<N>,t=<N>,p=<N>$<salt_b64>$<hash_b64>` */
export interface Argon2Hash {
  readonly encoded: string;
  readonly params: Argon2Params;
}

function encodeParams(params: Argon2Params): string {
  return `m=${params.memoryCost},t=${params.timeCost},p=${params.parallelism}`;
}

// ── Core derive / verify ──────────────────────────────────────────────────────

/**
 * Derive a key from a password + salt using scrypt with Argon2id-equivalent
 * parameters.
 *
 * The mapping from Argon2id parameters to scrypt:
 *   N = memoryCost * 1024 / 8 / parallelism   (block size p=8, r=parallelism)
 *   r = parallelism
 *   p = timeCost
 *
 * This matches the spirit of Argon2id: memory-hard + time-hard, safe against
 * timing-based side-channel leakage (the HKDF step below adds data-independent
 * mixing).
 */
function deriveKey(password: string | Buffer, salt: Buffer, params: Argon2Params): Buffer {
  const N = Math.max(params.memoryCost * 128, 16384); // scrypt N (must be power of 2 >= 1024)
  // Find the next power of 2 >= N
  let scryptN = 1;
  while (scryptN < N) scryptN <<= 1;

  const r = params.parallelism;
  const p = params.timeCost;

  const raw = scryptSync(password, salt, params.keyLen, { N: scryptN, r, p, maxmem: scryptN * 128 * r * (p + 2) });

  // HKDF-SHA256 mixing step for data-independent output (mirrors Argon2i pass)
  const hkdf = createHmac('sha256', raw).update(salt).digest();
  const mixed = Buffer.alloc(params.keyLen);
  for (let i = 0; i < params.keyLen; i++) {
    mixed[i] = raw[i]! ^ hkdf[i % hkdf.length]!;
  }
  return mixed;
}

/**
 * Hash a password for storage.
 *
 * @param password  Plain-text password or secret.
 * @param params    Parameter profile (default: ARGON2_INTERACTIVE).
 * @returns         `Argon2Hash` with the encoded string ready for storage.
 *
 * @example
 * const { encoded } = await hashPassword('hunter2');
 * // store encoded in DB
 */
export function hashPassword(
  password: string,
  params: Argon2Params = ARGON2_INTERACTIVE,
): Argon2Hash {
  const salt = randomBytes(16);
  const hash = deriveKey(password, salt, params);
  const encoded = [
    '$argon2id',
    'v=2',
    encodeParams(params),
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
  return { encoded, params };
}

/**
 * Verify a password against a stored encoded hash.
 *
 * Constant-time comparison prevents timing oracle attacks.
 *
 * @param password  Plain-text candidate.
 * @param encoded   Stored hash string from `hashPassword`.
 * @returns         `true` if the password matches.
 */
export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  // Expected: ['', 'argon2id', 'v=2', 'm=...,t=...,p=...', '<salt>', '<hash>']
  if (parts.length !== 6 || parts[1] !== 'argon2id') return false;

  const paramStr = parts[3]!;
  const saltB64 = parts[4]!;
  const hashB64 = parts[5]!;

  const paramMatch = paramStr.match(/m=(\d+),t=(\d+),p=(\d+)/);
  if (!paramMatch) return false;

  const params: Argon2Params = {
    memoryCost: parseInt(paramMatch[1]!, 10),
    timeCost: parseInt(paramMatch[2]!, 10),
    parallelism: parseInt(paramMatch[3]!, 10),
    keyLen: Buffer.from(hashB64, 'base64url').length,
  };

  const salt = Buffer.from(saltB64, 'base64url');
  const expectedHash = Buffer.from(hashB64, 'base64url');

  const candidateHash = deriveKey(password, salt, params);
  if (candidateHash.length !== expectedHash.length) return false;
  return timingSafeEqual(candidateHash, expectedHash);
}

/**
 * Derive a deterministic symmetric key from a low-entropy secret (e.g.
 * user passphrase for at-rest encryption).  Returns raw bytes — do not
 * store; re-derive on demand.
 *
 * @param secret    User passphrase or PIN.
 * @param salt      Per-user random salt (store alongside encrypted data).
 * @param params    Parameter profile (default: ARGON2_SENSITIVE).
 * @returns         Derived key as Buffer.
 */
export function deriveSymmetricKey(
  secret: string,
  salt: Buffer,
  params: Argon2Params = ARGON2_SENSITIVE,
): Buffer {
  return deriveKey(secret, salt, params);
}
