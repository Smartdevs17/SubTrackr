import { generateKeyPairSync, sign } from 'crypto';
import {
  AUTH_DATA_FLAGS,
  COSE_ALG,
  coseToPublicKey,
  decodeCbor,
  decodeCborFirst,
  fromBase64Url,
  parseAuthenticatorData,
  sha256,
  toBase64Url,
  verifySignature,
} from '../domain/webauthn';
import { encodeCbor, type EncodableCbor } from './helpers/softwareAuthenticator';

describe('webauthn primitives', () => {
  describe('base64url', () => {
    it('round-trips binary data', () => {
      const data = Buffer.from([0xfb, 0xff, 0x00, 0x10]);
      expect(fromBase64Url(toBase64Url(data)).equals(data)).toBe(true);
      expect(toBase64Url(data)).not.toMatch(/[+/=]/);
    });

    it('rejects non-base64url input', () => {
      expect(() => fromBase64Url('abc+/')).toThrow('Invalid base64url');
      expect(() => fromBase64Url(undefined as unknown as string)).toThrow('Invalid base64url');
    });
  });

  describe('CBOR decoding', () => {
    it('decodes the types used by WebAuthn', () => {
      const input = new Map<EncodableCbor, EncodableCbor>([
        ['fmt', 'none'],
        [1, 2],
        [-7, -257],
        ['big', 70_000],
        ['bytes', Buffer.from('abc')],
        ['list', [true, false, null]],
      ]);
      const decoded = decodeCbor(encodeCbor(input)) as Map<unknown, unknown>;

      expect(decoded.get('fmt')).toBe('none');
      expect(decoded.get(1)).toBe(2);
      expect(decoded.get(-7)).toBe(-257);
      expect(decoded.get('big')).toBe(70_000);
      expect((decoded.get('bytes') as Buffer).toString()).toBe('abc');
      expect(decoded.get('list')).toEqual([true, false, null]);
    });

    it('decodes undefined, tagged items and 64-bit lengths', () => {
      expect(decodeCbor(Buffer.from([0xf7]))).toBeUndefined();
      expect(decodeCbor(Buffer.from([0xc1, 0x05]))).toBe(5);
      expect(decodeCbor(Buffer.from([0x1b, 0, 0, 0, 0, 0, 0, 0x01, 0x00]))).toBe(256);
    });

    it('reports the length of the first item', () => {
      const first = encodeCbor([1, 2, 3]);
      const { value, length } = decodeCborFirst(Buffer.concat([first, Buffer.from([0x01])]));
      expect(value).toEqual([1, 2, 3]);
      expect(length).toBe(first.length);
    });

    it('rejects truncated, trailing and unsupported input', () => {
      expect(() => decodeCbor(Buffer.from([0x62, 0x61]))).toThrow('unexpected end');
      expect(() => decodeCbor(Buffer.from([0x01, 0x02]))).toThrow('trailing bytes');
      expect(() => decodeCbor(Buffer.from([0xf9, 0x00, 0x00]))).toThrow('unsupported simple value');
      expect(() => decodeCbor(Buffer.from([0x1f]))).toThrow('unsupported additional info');
      expect(() =>
        decodeCbor(Buffer.from([0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
      ).toThrow('safe range');
    });

    it('limits nesting depth', () => {
      const nested = Buffer.concat([Buffer.alloc(20, 0x81), Buffer.from([0x00])]);
      expect(() => decodeCbor(nested)).toThrow('maximum nesting depth');
    });
  });

  describe('parseAuthenticatorData', () => {
    const header = (flags: number, counter = 0): Buffer => {
      const buf = Buffer.alloc(37);
      sha256('localhost').copy(buf, 0);
      buf[32] = flags;
      buf.writeUInt32BE(counter, 33);
      return buf;
    };

    it('parses flags and the signature counter', () => {
      const parsed = parseAuthenticatorData(header(AUTH_DATA_FLAGS.UP | AUTH_DATA_FLAGS.UV, 42));
      expect(parsed.rpIdHash.equals(sha256('localhost'))).toBe(true);
      expect(parsed.userPresent).toBe(true);
      expect(parsed.userVerified).toBe(true);
      expect(parsed.backupEligible).toBe(false);
      expect(parsed.signCount).toBe(42);
      expect(parsed.attestedCredentialData).toBeUndefined();
    });

    it('skips extension data', () => {
      const data = Buffer.concat([
        header(AUTH_DATA_FLAGS.UP | AUTH_DATA_FLAGS.ED),
        encodeCbor(new Map([['ext', true]])),
      ]);
      expect(parseAuthenticatorData(data).userPresent).toBe(true);
    });

    it('rejects short, truncated and oversized data', () => {
      expect(() => parseAuthenticatorData(Buffer.alloc(10))).toThrow('too short');
      expect(() => parseAuthenticatorData(header(AUTH_DATA_FLAGS.AT))).toThrow('truncated');
      const badLength = Buffer.concat([
        header(AUTH_DATA_FLAGS.AT),
        Buffer.alloc(16),
        Buffer.from([0x00, 0x40]),
      ]);
      expect(() => parseAuthenticatorData(badLength)).toThrow('Credential ID truncated');
      expect(() => parseAuthenticatorData(Buffer.concat([header(0), Buffer.from([0x00])]))).toThrow(
        'trailing bytes'
      );
    });
  });

  describe('COSE keys and signatures', () => {
    it('verifies ES256 signatures', () => {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      const cose = encodeCbor(
        new Map<EncodableCbor, EncodableCbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x as string, 'base64url')],
          [-3, Buffer.from(jwk.y as string, 'base64url')],
        ])
      );
      const key = coseToPublicKey(cose);
      const data = Buffer.from('payload');
      const signature = sign('sha256', data, privateKey);

      expect(key.algorithm).toBe(COSE_ALG.ES256);
      expect(verifySignature(key.algorithm, key.keyObject, data, signature)).toBe(true);
      expect(
        verifySignature(key.algorithm, key.keyObject, Buffer.from('tampered'), signature)
      ).toBe(false);
      expect(verifySignature(key.algorithm, key.keyObject, data, Buffer.from('garbage'))).toBe(
        false
      );
    });

    it('rejects unsupported or malformed keys', () => {
      expect(() => coseToPublicKey(encodeCbor([1, 2]))).toThrow('CBOR map');
      expect(() =>
        coseToPublicKey(
          encodeCbor(
            new Map([
              [1, 2],
              [3, -35],
            ])
          )
        )
      ).toThrow('Unsupported COSE key');
      expect(() =>
        coseToPublicKey(
          encodeCbor(
            new Map<EncodableCbor, EncodableCbor>([
              [1, 2],
              [3, -7],
              [-1, 2],
              [-2, Buffer.alloc(32)],
              [-3, Buffer.alloc(32)],
            ])
          )
        )
      ).toThrow('Unsupported EC2 curve');
      expect(() =>
        coseToPublicKey(
          encodeCbor(
            new Map<EncodableCbor, EncodableCbor>([
              [1, 2],
              [3, -7],
              [-1, 1],
              [-2, Buffer.alloc(31)],
              [-3, Buffer.alloc(32)],
            ])
          )
        )
      ).toThrow('Invalid P-256 coordinates');
      expect(() =>
        coseToPublicKey(
          encodeCbor(
            new Map<EncodableCbor, EncodableCbor>([
              [1, 1],
              [3, -8],
              [-1, 6],
            ])
          )
        )
      ).toThrow('missing byte field');
      expect(() =>
        coseToPublicKey(
          encodeCbor(
            new Map<EncodableCbor, EncodableCbor>([
              [1, 1],
              [3, -8],
              [-1, 4],
              [-2, Buffer.alloc(32)],
            ])
          )
        )
      ).toThrow('Unsupported OKP curve');
    });
  });
});
