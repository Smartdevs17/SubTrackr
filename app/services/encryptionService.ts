// ════════════════════════════════════════════════════════════════
// ENCRYPTION SERVICE - PII encryption at rest (GDPR compliance)
// ════════════════════════════════════════════════════════════════
//
// Mirrors the `subtrackr-security` Soroban contract on the client so the app
// can encrypt subscriber PII before it is persisted or sent on-chain, and
// decrypt it only for authorized actors.
//
// Algorithm (identical to the contract so the formats are interoperable):
//   * Cipher: hash-based stream cipher in CTR mode. For each 32-byte block i,
//       keystream_i = SHA-256(key || nonce || counter_i_be)
//     XOR-ed with the plaintext. Symmetric: encrypt == decrypt.
//   * Integrity: encrypt-and-MAC tag = SHA-256(key || nonce || plaintext),
//     recomputed and compared on decrypt to detect tampering / wrong key.
//   * Keys are versioned for rotation; every record records the key version
//     used so it stays decryptable after rotations. A fresh nonce is derived
//     per record from a CSPRNG, so (key, nonce) pairs never repeat.
//
// The SHA-256 implementation is pure JS (no native dependency) so the service
// is deterministic and produces byte-identical output to the contract for the
// same (key, nonce, plaintext).

import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════

/** Self-describing ciphertext envelope. Hex-encoded for safe storage/transport. */
export interface EncryptedData {
  /** Version of the key used to encrypt this record. */
  keyVersion: number;
  /** 32-byte per-record nonce (hex). */
  nonce: string;
  /** XOR-keystream ciphertext (hex). */
  ciphertext: string;
  /** SHA-256(key || nonce || plaintext) integrity tag (hex). */
  mac: string;
}

/** A versioned 32-byte symmetric key. */
export interface EncryptionKey {
  version: number;
  /** 32 raw key bytes. */
  keyMaterial: Uint8Array;
  createdAt: number;
  /** Whether this key may be used for new encryptions (false once rotated out). */
  active: boolean;
}

/** Decides whether a given actor may decrypt PII. */
export type AccessController = (actorId: string) => boolean;

// ════════════════════════════════════════════════════════════════
// PII field registry
// ════════════════════════════════════════════════════════════════
//
// The subscriber fields that constitute personal data and MUST be encrypted
// at rest. Centralized so the same list drives encryption, export and audits.

export const PII_FIELDS = [
  'email',
  'fullName',
  'phone',
  'billingAddress',
  'taxId',
  'walletAddress',
  'ipAddress',
] as const;

export type PiiField = (typeof PII_FIELDS)[number];

export function isPiiField(field: string): field is PiiField {
  return (PII_FIELDS as readonly string[]).includes(field);
}

// ════════════════════════════════════════════════════════════════
// SHA-256 (pure JS) — matches the contract's env.crypto().sha256
// ════════════════════════════════════════════════════════════════

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 over `msg`, returning a 32-byte digest. */
export function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = msg.length * 8;
  // Pad: 0x80, then zeros, then 64-bit big-endian length.
  const withOne = msg.length + 1;
  const totalLen = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  // 64-bit length (high word is 0 for our message sizes).
  const dv = new DataView(padded.buffer);
  dv.setUint32(totalLen - 4, bitLen >>> 0, false);
  dv.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

  const w = new Uint32Array(64);
  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

// ════════════════════════════════════════════════════════════════
// Byte / hex / utf8 helpers
// ════════════════════════════════════════════════════════════════

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function utf8Encode(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // Minimal fallback.
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else s += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
  }
  return s;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(out);
    return out;
  }
  throw new Error('No CSPRNG available; ensure react-native-get-random-values is loaded');
}

// ════════════════════════════════════════════════════════════════
// Core cipher (mirrors contracts/security/src/encryption.rs)
// ════════════════════════════════════════════════════════════════

function keystreamBlock(key: Uint8Array, nonce: Uint8Array, counter: number): Uint8Array {
  return sha256(concat(key, nonce, u32be(counter)));
}

/** XOR stream cipher in CTR mode. Symmetric: same call encrypts and decrypts. */
export function xorCrypt(key: Uint8Array, nonce: Uint8Array, input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  let block = 0;
  let ks = keystreamBlock(key, nonce, block);
  for (let i = 0; i < input.length; i++) {
    const pos = i % 32;
    if (i !== 0 && pos === 0) {
      block += 1;
      ks = keystreamBlock(key, nonce, block);
    }
    out[i] = input[i] ^ ks[pos];
  }
  return out;
}

function computeMac(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return sha256(concat(key, nonce, plaintext));
}

function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ════════════════════════════════════════════════════════════════
// Key store
// ════════════════════════════════════════════════════════════════

const KEY_STORE_KEY = 'subtrackr-encryption-keys';
const CURRENT_VERSION_KEY = 'subtrackr-encryption-current-version';

interface StoredKey {
  version: number;
  keyMaterialHex: string;
  createdAt: number;
  active: boolean;
}

async function loadStoredKeys(): Promise<Record<number, StoredKey>> {
  const raw = await AsyncStorage.getItem(KEY_STORE_KEY);
  return raw ? (JSON.parse(raw) as Record<number, StoredKey>) : {};
}

async function persistKeys(keys: Record<number, StoredKey>): Promise<void> {
  await AsyncStorage.setItem(KEY_STORE_KEY, JSON.stringify(keys));
}

// ════════════════════════════════════════════════════════════════
// Service
// ════════════════════════════════════════════════════════════════

export interface EncryptionServiceOptions {
  /** Gate for who may decrypt PII. Defaults to "everyone" — override in apps. */
  accessController?: AccessController;
}

export class EncryptionService {
  private accessController: AccessController;

  constructor(opts: EncryptionServiceOptions = {}) {
    this.accessController = opts.accessController ?? (() => true);
  }

  /** Replace the access controller (e.g. wire to RBAC). */
  setAccessController(controller: AccessController): void {
    this.accessController = controller;
  }

  // ── Key management ─────────────────────────────────────────────

  /** Initialize the key store with version 1 if it does not yet exist. */
  async initialize(): Promise<EncryptionKey> {
    const keys = await loadStoredKeys();
    if (Object.keys(keys).length > 0) {
      return this.getCurrentKey();
    }
    const key: StoredKey = {
      version: 1,
      keyMaterialHex: toHex(randomBytes(32)),
      createdAt: Date.now(),
      active: true,
    };
    keys[1] = key;
    await persistKeys(keys);
    await AsyncStorage.setItem(CURRENT_VERSION_KEY, '1');
    return this.toKey(key);
  }

  /**
   * Rotate the key: deactivate the current version (keeping it for decrypting
   * old data) and create a new active version. Returns the new version.
   */
  async rotateKey(newKeyMaterial?: Uint8Array): Promise<number> {
    const keys = await loadStoredKeys();
    const current = await this.getCurrentVersion();
    if (keys[current]) {
      keys[current].active = false;
    }
    const newVersion = current + 1;
    keys[newVersion] = {
      version: newVersion,
      keyMaterialHex: toHex(newKeyMaterial ?? randomBytes(32)),
      createdAt: Date.now(),
      active: true,
    };
    await persistKeys(keys);
    await AsyncStorage.setItem(CURRENT_VERSION_KEY, String(newVersion));
    return newVersion;
  }

  async getCurrentVersion(): Promise<number> {
    const v = await AsyncStorage.getItem(CURRENT_VERSION_KEY);
    if (!v) throw new Error('Encryption not initialized — call initialize() first');
    return parseInt(v, 10);
  }

  async getCurrentKey(): Promise<EncryptionKey> {
    return this.getKey(await this.getCurrentVersion());
  }

  private async getKey(version: number): Promise<EncryptionKey> {
    const keys = await loadStoredKeys();
    const k = keys[version];
    if (!k) throw new Error(`Encryption key version ${version} not found`);
    return this.toKey(k);
  }

  private toKey(k: StoredKey): EncryptionKey {
    return {
      version: k.version,
      keyMaterial: fromHex(k.keyMaterialHex),
      createdAt: k.createdAt,
      active: k.active,
    };
  }

  // ── Encrypt / decrypt ──────────────────────────────────────────

  /** Encrypt a UTF-8 string under the current active key. */
  async encrypt(plaintext: string): Promise<EncryptedData> {
    const key = await this.getCurrentKey();
    if (!key.active) throw new Error('Current key is not active');
    const data = utf8Encode(plaintext);
    const nonce = randomBytes(32);
    const ciphertext = xorCrypt(key.keyMaterial, nonce, data);
    const mac = computeMac(key.keyMaterial, nonce, data);
    return {
      keyVersion: key.version,
      nonce: toHex(nonce),
      ciphertext: toHex(ciphertext),
      mac: toHex(mac),
    };
  }

  /** Decrypt to a UTF-8 string. Enforces access control and integrity. */
  async decrypt(encrypted: EncryptedData, actorId = 'system'): Promise<string> {
    if (!this.accessController(actorId)) {
      throw new Error(`Access denied: ${actorId} is not authorized to decrypt PII`);
    }
    const key = await this.getKey(encrypted.keyVersion);
    const nonce = fromHex(encrypted.nonce);
    const plaintext = xorCrypt(key.keyMaterial, nonce, fromHex(encrypted.ciphertext));
    const mac = computeMac(key.keyMaterial, nonce, plaintext);
    if (!ctEqual(mac, fromHex(encrypted.mac))) {
      throw new Error('MAC verification failed: data tampered or wrong key');
    }
    return utf8Decode(plaintext);
  }

  // ── Record-level helpers ───────────────────────────────────────

  /**
   * Encrypt the PII fields of a record in place, returning a copy where each
   * PII field's value is replaced by an EncryptedData envelope. Non-PII fields
   * are left untouched.
   */
  async encryptRecord<T extends Record<string, unknown>>(
    record: T,
    fields: readonly string[] = PII_FIELDS,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...record };
    for (const field of fields) {
      const value = record[field];
      if (value !== undefined && value !== null && value !== '') {
        out[field] = await this.encrypt(String(value));
      }
    }
    return out;
  }

  /** Inverse of encryptRecord: decrypt each EncryptedData-valued PII field. */
  async decryptRecord(
    record: Record<string, unknown>,
    fields: readonly string[] = PII_FIELDS,
    actorId = 'system',
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...record };
    for (const field of fields) {
      const value = record[field];
      if (value && typeof value === 'object' && 'ciphertext' in (value as object)) {
        out[field] = await this.decrypt(value as EncryptedData, actorId);
      }
    }
    return out;
  }

  // ── Data export ────────────────────────────────────────────────

  /**
   * Re-encrypt an existing record under the current active key (e.g. for a
   * GDPR data-export bundle or migrating ciphertext after a rotation). The
   * plaintext is decrypted and immediately re-encrypted; it is never exposed.
   */
  async exportEncrypted(encrypted: EncryptedData, actorId = 'system'): Promise<EncryptedData> {
    const plaintext = await this.decrypt(encrypted, actorId);
    return this.encrypt(plaintext);
  }
}

/** Shared default instance (override the access controller per app context). */
export const encryptionService = new EncryptionService();
