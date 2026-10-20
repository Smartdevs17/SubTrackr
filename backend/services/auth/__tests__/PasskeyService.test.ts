import { PasskeyService } from '../domain/PasskeyService';
import { AuthErrorCode } from '../errors';
import {
  SoftwareAuthenticator,
  encodeCbor,
  type EncodableCbor,
} from './helpers/softwareAuthenticator';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:8081';

function newService(
  overrides: ConstructorParameters<typeof PasskeyService>[0] = {}
): PasskeyService {
  return new PasskeyService({ rpId: RP_ID, rpName: 'SubTrackr', origins: [ORIGIN], ...overrides });
}

function register(
  service: PasskeyService,
  authenticator: SoftwareAuthenticator,
  userId = 'user-1'
) {
  const options = service.generateRegistrationOptions({
    userId,
    userName: `${userId}@example.com`,
  });
  return service.verifyRegistration({
    userId,
    response: authenticator.register(options),
    deviceName: 'Laptop',
  });
}

async function expectAuthError(fn: () => unknown, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected AuthError with code ${code}`);
}

describe('PasskeyService', () => {
  let service: PasskeyService;
  let authenticator: SoftwareAuthenticator;

  beforeEach(() => {
    service = newService();
    authenticator = new SoftwareAuthenticator('ES256');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateRegistrationOptions', () => {
    it('returns WebAuthn creation options with a random challenge and opaque user handle', () => {
      const options = service.generateRegistrationOptions({
        userId: 'user-1',
        userName: 'ada@example.com',
      });

      expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(options.rp).toEqual({ id: RP_ID, name: 'SubTrackr' });
      expect(options.user.name).toBe('ada@example.com');
      expect(options.user.displayName).toBe('ada@example.com');
      expect(options.user.id).not.toContain('user-1');
      expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -8, -257]);
      expect(options.attestation).toBe('none');
      expect(options.excludeCredentials).toEqual([]);
    });

    it('keeps the user handle stable and excludes already registered credentials', () => {
      const first = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      service.verifyRegistration({ userId: 'user-1', response: authenticator.register(first) });

      const second = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      expect(second.user.id).toBe(first.user.id);
      expect(second.challenge).not.toBe(first.challenge);
      expect(second.excludeCredentials).toEqual([
        { type: 'public-key', id: authenticator.id, transports: ['internal', 'hybrid'] },
      ]);
    });

    it('rejects missing user details', async () => {
      await expectAuthError(
        () => service.generateRegistrationOptions({ userId: '', userName: 'ada' }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
      await expectAuthError(
        () => service.generateRegistrationOptions({ userId: 'user-1', userName: '' }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });
  });

  describe('verifyRegistration', () => {
    it.each(['ES256', 'EdDSA', 'RS256'] as const)(
      'registers a %s passkey with "none" attestation',
      (alg) => {
        const auth = new SoftwareAuthenticator(alg);
        const credential = register(service, auth);

        expect(credential.id).toBe(auth.id);
        expect(credential.userId).toBe('user-1');
        expect(credential.algorithm).toBe(auth.coseAlgorithm);
        expect(credential.deviceName).toBe('Laptop');
        expect(credential.status).toBe('active');
        expect(credential.backupEligible).toBe(true);
        expect(credential.backedUp).toBe(true);
        expect(credential.aaguid).toBe('00000000-0000-0000-0000-000000000000');
        expect(service.listCredentials('user-1')).toHaveLength(1);
      }
    );

    it('accepts packed self attestation', () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const credential = service.verifyRegistration({
        userId: 'user-1',
        response: authenticator.register(options, { packed: true }),
      });
      expect(credential.id).toBe(authenticator.id);
    });

    it('rejects packed self attestation with a bad signature', async () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, {
              packed: true,
              corruptAttestationSignature: true,
            }),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects packed attestation with an invalid certificate', async () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const attStmt = new Map<EncodableCbor, EncodableCbor>([
        ['alg', -7],
        ['sig', Buffer.from('00', 'hex')],
        ['x5c', [Buffer.from('not a certificate')]],
      ]);
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, { fmt: 'packed', attStmt }),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects unsupported attestation formats and non-empty "none" statements', async () => {
      let options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, { fmt: 'tpm' }),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );

      options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const attStmt = new Map<EncodableCbor, EncodableCbor>([['alg', -7]]);
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, { attStmt }),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects a challenge that was never issued', async () => {
      service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const options = newService().generateRegistrationOptions({
        userId: 'user-1',
        userName: 'ada',
      });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options),
          }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it('rejects replaying a registration response', async () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const response = authenticator.register(options);
      service.verifyRegistration({ userId: 'user-1', response });
      await expectAuthError(
        () => service.verifyRegistration({ userId: 'user-1', response }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it('rejects an expired challenge', async () => {
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      spy.mockReturnValue(now + 6 * 60 * 1000);
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options),
          }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it('rejects a challenge issued for another user', async () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-2',
            response: authenticator.register(options),
          }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it('rejects a challenge issued for authentication', async () => {
      const authOptions = service.generateAuthenticationOptions({ userId: 'user-1' });
      const regOptions = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(regOptions, { challenge: authOptions.challenge }),
          }),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it.each([
      ['a disallowed origin', { origin: 'https://evil.example' }],
      ['the wrong client data type', { clientDataType: 'webauthn.get' }],
      ['a cross-origin ceremony', { crossOrigin: true }],
      ['a different RP ID', { rpId: 'evil.example' }],
      ['user presence missing', { flags: 0x40 }],
      ['a non public-key credential type', { credentialType: 'password' }],
      ['a mismatched raw ID', { rawIdOverride: Buffer.alloc(32, 1).toString('base64url') }],
    ])('rejects %s', async (_label, overrides) => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, overrides),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
      expect(service.listCredentials('user-1')).toHaveLength(0);
    });

    it('requires user verification when configured', async () => {
      service = newService({ userVerification: 'required' });
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, { flags: 0x41 }),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects registering the same credential twice', async () => {
      register(service, authenticator, 'user-1');
      await expectAuthError(
        () => register(service, authenticator, 'user-2'),
        AuthErrorCode.PASSKEY_CREDENTIAL_EXISTS
      );
    });

    it('enforces the per-user credential limit', async () => {
      service = newService({ maxCredentialsPerUser: 1 });
      register(service, authenticator);
      await expectAuthError(
        () => register(service, new SoftwareAuthenticator('ES256')),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects malformed payloads', async () => {
      let options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const response = authenticator.register(options);
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: { ...response, response: { ...response.response, clientDataJSON: '***' } },
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );

      options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const valid = authenticator.register(options);
      const notAMap = encodeCbor(['fmt']).toString('base64url');
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: { ...valid, response: { ...valid.response, attestationObject: notAMap } },
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('records failures in the audit log', async () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      await expectAuthError(
        () =>
          service.verifyRegistration({
            userId: 'user-1',
            response: authenticator.register(options, { origin: 'https://evil.example' }),
          }),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
      const [latest] = service.getAuditLog({ userId: 'user-1' });
      expect(latest.action).toBe('registration_failed');
      expect(latest.detail).toContain('origin not allowed');
    });
  });

  describe('authentication', () => {
    beforeEach(() => {
      authenticator = new SoftwareAuthenticator('ES256', {
        rpId: RP_ID,
        origin: ORIGIN,
        signCount: 5,
      });
      register(service, authenticator);
    });

    it('lists the user credentials in allowCredentials', () => {
      const options = service.generateAuthenticationOptions({ userId: 'user-1' });
      expect(options.rpId).toBe(RP_ID);
      expect(options.allowCredentials.map((c) => c.id)).toEqual([authenticator.id]);
    });

    it('authenticates a registered passkey and advances the counter', () => {
      const options = service.generateAuthenticationOptions({ userId: 'user-1' });
      const result = service.verifyAuthentication(authenticator.assert(options));

      expect(result).toEqual({
        userId: 'user-1',
        credentialId: authenticator.id,
        userVerified: true,
        signCount: 6,
      });
      const [credential] = service.listCredentials('user-1');
      expect(credential.signCount).toBe(6);
      expect(credential.lastUsedAt).not.toBeNull();
    });

    it('supports usernameless login with discoverable credentials', () => {
      const options = service.generateAuthenticationOptions();
      expect(options.allowCredentials).toEqual([]);
      const result = service.verifyAuthentication(authenticator.assert(options));
      expect(result.userId).toBe('user-1');
    });

    it('supports authenticators without a signature counter', () => {
      const counterless = new SoftwareAuthenticator('EdDSA');
      register(service, counterless, 'user-2');
      for (let i = 0; i < 3; i++) {
        const options = service.generateAuthenticationOptions({ userId: 'user-2' });
        expect(service.verifyAuthentication(counterless.assert(options)).signCount).toBe(0);
      }
    });

    it('rejects a replayed assertion', async () => {
      const options = service.generateAuthenticationOptions({ userId: 'user-1' });
      const response = authenticator.assert(options);
      service.verifyAuthentication(response);
      await expectAuthError(
        () => service.verifyAuthentication(response),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it('rejects a registration challenge', async () => {
      const options = service.generateRegistrationOptions({ userId: 'user-1', userName: 'ada' });
      const authOptions = {
        challenge: options.challenge,
        rpId: RP_ID,
        timeout: 1,
        allowCredentials: [],
        userVerification: 'preferred' as const,
      };
      await expectAuthError(
        () => service.verifyAuthentication(authenticator.assert(authOptions)),
        AuthErrorCode.PASSKEY_CHALLENGE_INVALID
      );
    });

    it('rejects an invalid signature', async () => {
      const options = service.generateAuthenticationOptions({ userId: 'user-1' });
      await expectAuthError(
        () =>
          service.verifyAuthentication(authenticator.assert(options, { corruptSignature: true })),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects an unknown credential', async () => {
      const options = service.generateAuthenticationOptions();
      const stranger = new SoftwareAuthenticator('ES256');
      await expectAuthError(
        () => service.verifyAuthentication(stranger.assert(options)),
        AuthErrorCode.PASSKEY_CREDENTIAL_NOT_FOUND
      );
    });

    it('rejects a credential that belongs to another user', async () => {
      const options = service.generateAuthenticationOptions({ userId: 'user-2' });
      await expectAuthError(
        () => service.verifyAuthentication(authenticator.assert(options)),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('rejects a mismatched user handle', async () => {
      const options = service.generateAuthenticationOptions();
      await expectAuthError(
        () =>
          service.verifyAuthentication(
            authenticator.assert(options, { userHandle: 'someone-else' })
          ),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it.each([
      ['a disallowed origin', { origin: 'https://evil.example' }],
      ['the wrong client data type', { clientDataType: 'webauthn.create' }],
      ['a different RP ID', { rpId: 'evil.example' }],
      ['user presence missing', { flags: 0x00 }],
    ])('rejects %s', async (_label, overrides) => {
      const options = service.generateAuthenticationOptions({ userId: 'user-1' });
      await expectAuthError(
        () => service.verifyAuthentication(authenticator.assert(options, overrides)),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });

    it('suspends the credential when the signature counter goes backwards', async () => {
      let options = service.generateAuthenticationOptions({ userId: 'user-1' });
      service.verifyAuthentication(authenticator.assert(options)); // counter → 6

      options = service.generateAuthenticationOptions({ userId: 'user-1' });
      await expectAuthError(
        () => service.verifyAuthentication(authenticator.assert(options, { signCount: 6 })),
        AuthErrorCode.PASSKEY_COUNTER_REGRESSION
      );
      expect(service.listCredentials('user-1')[0].status).toBe('suspended');
      expect(
        service.getAuditLog({ userId: 'user-1' }).some((e) => e.action === 'counter_regression')
      ).toBe(true);

      // A suspended credential can no longer be used, even with a valid counter.
      options = service.generateAuthenticationOptions({ userId: 'user-1' });
      expect(options.allowCredentials).toEqual([]);
      await expectAuthError(
        () => service.verifyAuthentication(authenticator.assert(options, { signCount: 50 })),
        AuthErrorCode.PASSKEY_VERIFICATION_FAILED
      );
    });
  });

  describe('credential management', () => {
    it('removes a credential owned by the user', () => {
      register(service, authenticator);
      expect(service.removeCredential('user-1', authenticator.id)).toBe(true);
      expect(service.listCredentials('user-1')).toEqual([]);
    });

    it('refuses to remove a credential owned by someone else', async () => {
      register(service, authenticator);
      await expectAuthError(
        () => service.removeCredential('user-2', authenticator.id),
        AuthErrorCode.PASSKEY_CREDENTIAL_NOT_FOUND
      );
      expect(service.listCredentials('user-1')).toHaveLength(1);
    });

    it('sweeps expired challenges', () => {
      service.generateAuthenticationOptions();
      service.generateAuthenticationOptions();
      expect(service.sweepExpiredChallenges(Date.now() + 10 * 60 * 1000)).toBe(2);
      expect(service.sweepExpiredChallenges()).toBe(0);
    });

    it('exposes a copy of the configuration', () => {
      const config = service.getConfig();
      config.origins.push('https://evil.example');
      expect(service.getConfig().origins).toEqual([ORIGIN]);
    });
  });
});
