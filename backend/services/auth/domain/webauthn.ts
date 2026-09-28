/**
 * WebAuthn primitives — SubTrackr
 *
 * Issue #1272: Implement passwordless login with passkeys
 *
 * Minimal, dependency-free building blocks for verifying WebAuthn ceremonies:
 *   - base64url encode / decode
 *   - CBOR decoding (the subset used by attestation objects and COSE keys)
 *   - Authenticator data parsing (flags, sign counter, attested credential)
 *   - COSE public key → Node KeyObject conversion (ES256, EdDSA, RS256)
 *   - Assertion / attestation signature verification
 */

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto';

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function toBase64Url(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString('base64url');
}

export function fromBase64Url(input: string): Buffer {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(input)) {
    throw new Error('Invalid base64url string');
  }
  return Buffer.from(input, 'base64url');
}

export function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

// ---------------------------------------------------------------------------
// CBOR (RFC 8949) — decode only
// ---------------------------------------------------------------------------

export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | undefined
  | Buffer
  | CborValue[]
  | Map<CborValue, CborValue>;

const MAX_CBOR_DEPTH = 16;

class CborReader {
  offset = 0;

  constructor(private readonly buf: Buffer) {}

  private ensure(length: number): void {
    if (this.offset + length > this.buf.length) {
      throw new Error('CBOR: unexpected end of input');
    }
  }

  private readLength(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) {
      this.ensure(1);
      return this.buf.readUInt8(this.offset++);
    }
    if (additional === 25) {
      this.ensure(2);
      const value = this.buf.readUInt16BE(this.offset);
      this.offset += 2;
      return value;
    }
    if (additional === 26) {
      this.ensure(4);
      const value = this.buf.readUInt32BE(this.offset);
      this.offset += 4;
      return value;
    }
    if (additional === 27) {
      this.ensure(8);
      const value = this.buf.readBigUInt64BE(this.offset);
      this.offset += 8;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('CBOR: integer exceeds safe range');
      }
      return Number(value);
    }
    throw new Error(`CBOR: unsupported additional info ${additional}`);
  }

  read(depth = 0): CborValue {
    if (depth > MAX_CBOR_DEPTH) throw new Error('CBOR: maximum nesting depth exceeded');
    this.ensure(1);
    const initial = this.buf.readUInt8(this.offset++);
    const major = initial >> 5;
    const additional = initial & 0x1f;

    switch (major) {
      case 0:
        return this.readLength(additional);
      case 1:
        return -1 - this.readLength(additional);
      case 2: {
        const length = this.readLength(additional);
        this.ensure(length);
        const bytes = Buffer.from(this.buf.subarray(this.offset, this.offset + length));
        this.offset += length;
        return bytes;
      }
      case 3: {
        const length = this.readLength(additional);
        this.ensure(length);
        const text = this.buf.toString('utf8', this.offset, this.offset + length);
        this.offset += length;
        return text;
      }
      case 4: {
        const length = this.readLength(additional);
        const items: CborValue[] = [];
        for (let i = 0; i < length; i++) items.push(this.read(depth + 1));
        return items;
      }
      case 5: {
        const length = this.readLength(additional);
        const map = new Map<CborValue, CborValue>();
        for (let i = 0; i < length; i++) {
          const key = this.read(depth + 1);
          map.set(key, this.read(depth + 1));
        }
        return map;
      }
      case 6:
        // Semantic tag — skip the tag number and return the tagged item.
        this.readLength(additional);
        return this.read(depth + 1);
      case 7:
        if (additional === 20) return false;
        if (additional === 21) return true;
        if (additional === 22) return null;
        if (additional === 23) return undefined;
        throw new Error(`CBOR: unsupported simple value ${additional}`);
      default:
        throw new Error(`CBOR: unsupported major type ${major}`);
    }
  }
}

/**
 * Decode the first CBOR item in `buf`. Returns the value and the number of
 * bytes consumed so callers can locate trailing data (e.g. extensions after a
 * COSE key inside authenticator data).
 */
export function decodeCborFirst(buf: Buffer): { value: CborValue; length: number } {
  const reader = new CborReader(buf);
  const value = reader.read();
  return { value, length: reader.offset };
}

/** Decode a buffer that must contain exactly one CBOR item. */
export function decodeCbor(buf: Buffer): CborValue {
  const { value, length } = decodeCborFirst(buf);
  if (length !== buf.length) throw new Error('CBOR: trailing bytes after item');
  return value;
}

// ---------------------------------------------------------------------------
// Authenticator data (WebAuthn §6.1)
// ---------------------------------------------------------------------------

export const AUTH_DATA_FLAGS = {
  UP: 0x01, // user present
  UV: 0x04, // user verified
  BE: 0x08, // backup eligible
  BS: 0x10, // backup state
  AT: 0x40, // attested credential data included
  ED: 0x80, // extension data included
} as const;

export interface AttestedCredentialData {
  aaguid: string;
  credentialId: Buffer;
  credentialPublicKey: Buffer;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  signCount: number;
  attestedCredentialData?: AttestedCredentialData;
}

export function parseAuthenticatorData(authData: Buffer): ParsedAuthenticatorData {
  if (authData.length < 37) throw new Error('Authenticator data too short');

  const rpIdHash = Buffer.from(authData.subarray(0, 32));
  const flags = authData.readUInt8(32);
  const signCount = authData.readUInt32BE(33);
  let offset = 37;

  let attestedCredentialData: AttestedCredentialData | undefined;
  if (flags & AUTH_DATA_FLAGS.AT) {
    if (authData.length < offset + 18) throw new Error('Attested credential data truncated');
    const aaguidHex = authData.subarray(offset, offset + 16).toString('hex');
    offset += 16;
    const credentialIdLength = authData.readUInt16BE(offset);
    offset += 2;
    if (authData.length < offset + credentialIdLength) throw new Error('Credential ID truncated');
    const credentialId = Buffer.from(authData.subarray(offset, offset + credentialIdLength));
    offset += credentialIdLength;
    const { length } = decodeCborFirst(authData.subarray(offset));
    const credentialPublicKey = Buffer.from(authData.subarray(offset, offset + length));
    offset += length;

    attestedCredentialData = {
      aaguid: [
        aaguidHex.slice(0, 8),
        aaguidHex.slice(8, 12),
        aaguidHex.slice(12, 16),
        aaguidHex.slice(16, 20),
        aaguidHex.slice(20),
      ].join('-'),
      credentialId,
      credentialPublicKey,
    };
  }

  if (flags & AUTH_DATA_FLAGS.ED) {
    const { length } = decodeCborFirst(authData.subarray(offset));
    offset += length;
  }

  if (offset !== authData.length) throw new Error('Authenticator data has trailing bytes');

  return {
    rpIdHash,
    flags,
    userPresent: (flags & AUTH_DATA_FLAGS.UP) !== 0,
    userVerified: (flags & AUTH_DATA_FLAGS.UV) !== 0,
    backupEligible: (flags & AUTH_DATA_FLAGS.BE) !== 0,
    backedUp: (flags & AUTH_DATA_FLAGS.BS) !== 0,
    signCount,
    attestedCredentialData,
  };
}

// ---------------------------------------------------------------------------
// COSE keys (RFC 9053)
// ---------------------------------------------------------------------------

export const COSE_ALG = {
  ES256: -7,
  EdDSA: -8,
  RS256: -257,
} as const;

export type CoseAlgorithm = (typeof COSE_ALG)[keyof typeof COSE_ALG];

export const SUPPORTED_COSE_ALGORITHMS: CoseAlgorithm[] = [
  COSE_ALG.ES256,
  COSE_ALG.EdDSA,
  COSE_ALG.RS256,
];

const COSE_KTY_OKP = 1;
const COSE_KTY_EC2 = 2;
const COSE_KTY_RSA = 3;
const COSE_CRV_P256 = 1;
const COSE_CRV_ED25519 = 6;

function coseBytes(map: Map<CborValue, CborValue>, label: number): Buffer {
  const value = map.get(label);
  if (!Buffer.isBuffer(value)) throw new Error(`COSE key missing byte field ${label}`);
  return value;
}

export interface CosePublicKey {
  algorithm: CoseAlgorithm;
  keyObject: KeyObject;
}

export function coseToPublicKey(cose: Buffer): CosePublicKey {
  const decoded = decodeCbor(cose);
  if (!(decoded instanceof Map)) throw new Error('COSE key must be a CBOR map');

  const kty = decoded.get(1);
  const alg = decoded.get(3);

  if (kty === COSE_KTY_EC2 && alg === COSE_ALG.ES256) {
    if (decoded.get(-1) !== COSE_CRV_P256) throw new Error('Unsupported EC2 curve');
    const x = coseBytes(decoded, -2);
    const y = coseBytes(decoded, -3);
    if (x.length !== 32 || y.length !== 32) throw new Error('Invalid P-256 coordinates');
    const keyObject = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y) },
      format: 'jwk',
    });
    return { algorithm: COSE_ALG.ES256, keyObject };
  }

  if (kty === COSE_KTY_OKP && alg === COSE_ALG.EdDSA) {
    if (decoded.get(-1) !== COSE_CRV_ED25519) throw new Error('Unsupported OKP curve');
    const x = coseBytes(decoded, -2);
    if (x.length !== 32) throw new Error('Invalid Ed25519 public key');
    const keyObject = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(x) },
      format: 'jwk',
    });
    return { algorithm: COSE_ALG.EdDSA, keyObject };
  }

  if (kty === COSE_KTY_RSA && alg === COSE_ALG.RS256) {
    const n = coseBytes(decoded, -1);
    const e = coseBytes(decoded, -2);
    const keyObject = createPublicKey({
      key: { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e) },
      format: 'jwk',
    });
    return { algorithm: COSE_ALG.RS256, keyObject };
  }

  throw new Error(`Unsupported COSE key (kty=${String(kty)}, alg=${String(alg)})`);
}

/** Verify a WebAuthn signature produced with the given COSE algorithm. */
export function verifySignature(
  algorithm: CoseAlgorithm,
  keyObject: KeyObject,
  data: Buffer,
  signature: Buffer
): boolean {
  try {
    if (algorithm === COSE_ALG.EdDSA) return cryptoVerify(null, data, keyObject, signature);
    return cryptoVerify('sha256', data, keyObject, signature);
  } catch {
    return false;
  }
}
