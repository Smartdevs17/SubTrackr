/**
 * Test-only software authenticator that produces real WebAuthn registration
 * and assertion responses (CBOR attestation objects, authenticator data and
 * signatures) using Node's crypto module.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'crypto';
import type {
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationResponse,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResponse,
} from '../../interfaces';

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (inverse of the decoder under test)
// ---------------------------------------------------------------------------

export type EncodableCbor =
  | number
  | string
  | boolean
  | null
  | Buffer
  | EncodableCbor[]
  | Map<EncodableCbor, EncodableCbor>;

function encodeHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const buf = Buffer.alloc(3);
    buf[0] = (major << 5) | 25;
    buf.writeUInt16BE(length, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = (major << 5) | 26;
  buf.writeUInt32BE(length, 1);
  return buf;
}

export function encodeCbor(value: EncodableCbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? encodeHead(0, value) : encodeHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeHead(3, bytes.length), bytes]);
  }
  if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  if (Buffer.isBuffer(value)) return Buffer.concat([encodeHead(2, value.length), value]);
  if (Array.isArray(value)) {
    return Buffer.concat([encodeHead(4, value.length), ...value.map(encodeCbor)]);
  }
  const parts: Buffer[] = [encodeHead(5, value.size)];
  for (const [k, v] of value) parts.push(encodeCbor(k), encodeCbor(v));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Authenticator
// ---------------------------------------------------------------------------

export type TestAlgorithm = 'ES256' | 'EdDSA' | 'RS256';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const b64u = (buf: Buffer): string => buf.toString('base64url');
const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();

export interface CeremonyOverrides {
  origin?: string;
  clientDataType?: string;
  challenge?: string;
  crossOrigin?: boolean;
  rpId?: string;
  flags?: number;
  signCount?: number;
  credentialType?: string;
}

export interface RegistrationOverrides extends CeremonyOverrides {
  fmt?: string;
  attStmt?: Map<EncodableCbor, EncodableCbor>;
  /** Produce a packed self-attestation instead of `none`. */
  packed?: boolean;
  corruptAttestationSignature?: boolean;
  rawIdOverride?: string;
}

export interface AssertionOverrides extends CeremonyOverrides {
  corruptSignature?: boolean;
  userHandle?: string | null;
  credentialIdOverride?: string;
}

export class SoftwareAuthenticator {
  readonly credentialId: Buffer = randomBytes(32);
  readonly aaguid: Buffer = Buffer.alloc(16);
  signCount: number;
  userHandle: string | null = null;

  private readonly privateKey: KeyObject;
  private readonly cosePublicKey: Buffer;

  constructor(
    readonly algorithm: TestAlgorithm = 'ES256',
    private readonly defaults: { rpId: string; origin: string; signCount?: number } = {
      rpId: 'localhost',
      origin: 'http://localhost:8081',
    }
  ) {
    this.signCount = defaults.signCount ?? 0;

    if (algorithm === 'ES256') {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      this.privateKey = privateKey;
      this.cosePublicKey = encodeCbor(
        new Map<EncodableCbor, EncodableCbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x as string, 'base64url')],
          [-3, Buffer.from(jwk.y as string, 'base64url')],
        ])
      );
    } else if (algorithm === 'EdDSA') {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const jwk = publicKey.export({ format: 'jwk' });
      this.privateKey = privateKey;
      this.cosePublicKey = encodeCbor(
        new Map<EncodableCbor, EncodableCbor>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, Buffer.from(jwk.x as string, 'base64url')],
        ])
      );
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = publicKey.export({ format: 'jwk' });
      this.privateKey = privateKey;
      this.cosePublicKey = encodeCbor(
        new Map<EncodableCbor, EncodableCbor>([
          [1, 3],
          [3, -257],
          [-1, Buffer.from(jwk.n as string, 'base64url')],
          [-2, Buffer.from(jwk.e as string, 'base64url')],
        ])
      );
    }
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  get coseAlgorithm(): number {
    return this.algorithm === 'ES256' ? -7 : this.algorithm === 'EdDSA' ? -8 : -257;
  }

  register(
    options: PasskeyRegistrationOptions,
    overrides: RegistrationOverrides = {}
  ): PasskeyRegistrationResponse {
    this.userHandle = options.user.id;
    const clientDataJSON = this.clientData('webauthn.create', options.challenge, overrides);

    const credIdLength = Buffer.alloc(2);
    credIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      this.authDataHeader(
        overrides,
        FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT,
        this.signCount
      ),
      this.aaguid,
      credIdLength,
      this.credentialId,
      this.cosePublicKey,
    ]);

    let fmt = overrides.fmt ?? 'none';
    let attStmt = overrides.attStmt ?? new Map<EncodableCbor, EncodableCbor>();
    if (overrides.packed) {
      fmt = 'packed';
      let sig = this.sign(Buffer.concat([authData, sha256(clientDataJSON)]));
      if (overrides.corruptAttestationSignature) sig = Buffer.from(sig.map((b) => b ^ 0xff));
      attStmt = new Map<EncodableCbor, EncodableCbor>([
        ['alg', this.coseAlgorithm],
        ['sig', sig],
      ]);
    }

    const attestationObject = encodeCbor(
      new Map<EncodableCbor, EncodableCbor>([
        ['fmt', fmt],
        ['attStmt', attStmt],
        ['authData', authData],
      ])
    );

    const rawId = overrides.rawIdOverride ?? this.id;
    return {
      id: rawId,
      rawId,
      type: overrides.credentialType ?? 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  assert(
    options: PasskeyAuthenticationOptions,
    overrides: AssertionOverrides = {}
  ): PasskeyAuthenticationResponse {
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, overrides);
    if (overrides.signCount === undefined && this.signCount > 0) this.signCount++;
    const signCount = overrides.signCount ?? this.signCount;

    const authData = this.authDataHeader(
      overrides,
      FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS,
      signCount
    );
    let signature = this.sign(Buffer.concat([authData, sha256(clientDataJSON)]));
    if (overrides.corruptSignature) signature = Buffer.from(signature.map((b) => b ^ 0xff));

    const credentialId = overrides.credentialIdOverride ?? this.id;
    return {
      id: credentialId,
      rawId: credentialId,
      type: overrides.credentialType ?? 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: overrides.userHandle !== undefined ? overrides.userHandle : this.userHandle,
      },
    };
  }

  private clientData(type: string, challenge: string, overrides: CeremonyOverrides): Buffer {
    return Buffer.from(
      JSON.stringify({
        type: overrides.clientDataType ?? type,
        challenge: overrides.challenge ?? challenge,
        origin: overrides.origin ?? this.defaults.origin,
        crossOrigin: overrides.crossOrigin ?? false,
      }),
      'utf8'
    );
  }

  private authDataHeader(
    overrides: CeremonyOverrides,
    defaultFlags: number,
    signCount: number
  ): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(overrides.signCount ?? signCount);
    return Buffer.concat([
      sha256(overrides.rpId ?? this.defaults.rpId),
      Buffer.from([overrides.flags ?? defaultFlags]),
      counter,
    ]);
  }

  private sign(data: Buffer): Buffer {
    return this.algorithm === 'EdDSA'
      ? sign(null, data, this.privateKey)
      : sign('sha256', data, this.privateKey);
  }
}
