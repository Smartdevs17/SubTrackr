import {
  DeviceAuthorizationService,
  OAuthError,
  normalizeUserCode,
} from '../domain/DeviceAuthorizationService';
import { AuthErrorCode } from '../errors';

const CLIENTS = {
  cli: {
    name: 'SubTrackr CLI',
    allowedScopes: ['profile:read', 'subscriptions:read', 'subscriptions:write', 'sessions:read'],
    defaultScopes: ['profile:read'],
  },
  tv: { name: 'TV app', allowedScopes: ['subscriptions:read'] },
  evil: { name: 'Misconfigured', allowedScopes: ['*', 'auth:manage', 'profile:read'] },
};

function oauthError(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof OAuthError) return err.error;
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('DeviceAuthorizationService (RFC 8628)', () => {
  let clock: number;
  let service: DeviceAuthorizationService;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    service = new DeviceAuthorizationService(
      { clients: CLIENTS, verificationUri: 'https://app.subtrackr.test/device' },
      () => clock
    );
  });

  describe('device authorization request', () => {
    it('issues device_code, user_code, verification URIs, expiry and interval', () => {
      const res = service.requestAuthorization({ clientId: 'cli', scope: 'subscriptions:read' });
      expect(res.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
      expect(res.verification_uri).toBe('https://app.subtrackr.test/device');
      expect(res.verification_uri_complete).toBe(
        `https://app.subtrackr.test/device?user_code=${res.user_code}`
      );
      expect(res.expires_in).toBe(600);
      expect(res.interval).toBe(5);
    });

    it('never stores the codes in plaintext', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      const state = JSON.stringify([
        ...(service as unknown as { grants: Map<string, unknown> }).grants.entries(),
        ...(service as unknown as { userCodes: Map<string, unknown> }).userCodes.entries(),
      ]);
      expect(state).not.toContain(res.device_code);
      expect(state).not.toContain(normalizeUserCode(res.user_code));
    });

    it('rejects unknown clients and scopes the client may not request', () => {
      expect(oauthError(() => service.requestAuthorization({ clientId: 'nope' }))).toBe(
        'invalid_client'
      );
      expect(
        oauthError(() => service.requestAuthorization({ clientId: 'tv', scope: 'sessions:read' }))
      ).toBe('invalid_scope');
      // `*` and auth:manage are never delegable, even if a client is misconfigured.
      expect(oauthError(() => service.requestAuthorization({ clientId: 'evil', scope: '*' }))).toBe(
        'invalid_scope'
      );
      expect(
        oauthError(() => service.requestAuthorization({ clientId: 'evil', scope: 'auth:manage' }))
      ).toBe('invalid_scope');
    });

    it('falls back to the client default scopes', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      expect(service.describe(res.user_code, 'u1').scopes).toEqual(['profile:read']);
    });
  });

  describe('polling', () => {
    it('walks through authorization_pending → slow_down → tokens exactly once', () => {
      const res = service.requestAuthorization({
        clientId: 'cli',
        scope: 'subscriptions:read sessions:read',
      });
      const poll = () => service.poll({ clientId: 'cli', deviceCode: res.device_code });

      expect(oauthError(poll)).toBe('authorization_pending');
      clock += 1000;
      expect(oauthError(poll)).toBe('slow_down');
      expect(service.getInterval(res.device_code)).toBe(10);
      clock += 10_000;
      expect(oauthError(poll)).toBe('authorization_pending');

      service.approve({ userCode: res.user_code, approverId: 'u1', approverScopes: ['*'] });
      clock += 10_000;
      expect(poll()).toEqual({
        userId: 'u1',
        clientId: 'cli',
        scopes: ['subscriptions:read', 'sessions:read'],
      });
      clock += 10_000;
      expect(oauthError(poll)).toBe('invalid_grant');
    });

    it('returns access_denied when the user denies', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      service.deny({ userCode: res.user_code, approverId: 'u1' });
      expect(oauthError(() => service.poll({ clientId: 'cli', deviceCode: res.device_code }))).toBe(
        'access_denied'
      );
      expect(oauthError(() => service.poll({ clientId: 'cli', deviceCode: res.device_code }))).toBe(
        'invalid_grant'
      );
    });

    it('returns expired_token once the codes lapse, even if approved too late', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      clock += 10 * 60 * 1000 + 1;
      expect(
        oauthError(() =>
          service.approve({ userCode: res.user_code, approverId: 'u1', approverScopes: ['*'] })
        )
      ).toBe(AuthErrorCode.USER_CODE_INVALID);
      expect(oauthError(() => service.poll({ clientId: 'cli', deviceCode: res.device_code }))).toBe(
        'expired_token'
      );
    });

    it('rejects device codes presented by another client or unknown codes', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      expect(oauthError(() => service.poll({ clientId: 'tv', deviceCode: res.device_code }))).toBe(
        'invalid_grant'
      );
      expect(oauthError(() => service.poll({ clientId: 'cli', deviceCode: 'guess' }))).toBe(
        'invalid_grant'
      );
      expect(
        oauthError(() => service.poll({ clientId: 'ghost', deviceCode: res.device_code }))
      ).toBe('invalid_client');
      expect(oauthError(() => service.poll({ clientId: 'cli' }))).toBe('invalid_request');
    });
  });

  describe('approval', () => {
    it('accepts the user code case-insensitively and without the dash', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      const typed = res.user_code.replace('-', ' ').toLowerCase();
      expect(service.describe(typed, 'u1')).toMatchObject({
        clientId: 'cli',
        clientName: 'SubTrackr CLI',
      });
    });

    it('makes user codes single-use', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      service.approve({ userCode: res.user_code, approverId: 'u1', approverScopes: ['*'] });
      expect(
        oauthError(() =>
          service.approve({ userCode: res.user_code, approverId: 'u2', approverScopes: ['*'] })
        )
      ).toBe(AuthErrorCode.USER_CODE_INVALID);
      expect(oauthError(() => service.deny({ userCode: res.user_code, approverId: 'u1' }))).toBe(
        AuthErrorCode.USER_CODE_INVALID
      );
    });

    it('lets the user narrow the requested scopes but never widen them', () => {
      const res = service.requestAuthorization({
        clientId: 'cli',
        scope: 'subscriptions:read subscriptions:write',
      });
      expect(
        oauthError(() =>
          service.approve({
            userCode: res.user_code,
            approverId: 'u1',
            approverScopes: ['*'],
            scopes: ['subscriptions:read', 'sessions:read'],
          })
        )
      ).toBe(AuthErrorCode.USER_CODE_INVALID);

      const approved = service.approve({
        userCode: res.user_code,
        approverId: 'u1',
        approverScopes: ['*'],
        scopes: ['subscriptions:read'],
      });
      expect(approved.grantedScopes).toEqual(['subscriptions:read']);
      expect(service.poll({ clientId: 'cli', deviceCode: res.device_code }).scopes).toEqual([
        'subscriptions:read',
      ]);
    });

    it('refuses to grant scopes the approver does not hold', () => {
      const res = service.requestAuthorization({ clientId: 'cli', scope: 'subscriptions:write' });
      expect(
        oauthError(() =>
          service.approve({
            userCode: res.user_code,
            approverId: 'u1',
            approverScopes: ['subscriptions:read'],
          })
        )
      ).toBe(AuthErrorCode.INSUFFICIENT_SCOPE);
      // The failed attempt did not consume the code.
      expect(service.describe(res.user_code, 'u1').scopes).toEqual(['subscriptions:write']);
    });

    it('rate limits repeated wrong user codes per approver', () => {
      const res = service.requestAuthorization({ clientId: 'cli' });
      for (let i = 0; i < 10; i++) {
        expect(oauthError(() => service.describe('BBBB-BBBB', 'brute'))).toBe(
          AuthErrorCode.USER_CODE_INVALID
        );
      }
      expect(oauthError(() => service.describe(res.user_code, 'brute'))).toBe(
        AuthErrorCode.USER_CODE_ATTEMPTS_EXCEEDED
      );
      // Other approvers are unaffected.
      expect(service.describe(res.user_code, 'u1').clientId).toBe('cli');
      clock += 15 * 60 * 1000 + 1;
      const fresh = service.requestAuthorization({ clientId: 'cli' });
      expect(service.describe(fresh.user_code, 'brute').clientId).toBe('cli');
    });
  });

  it('sweeps grants long past expiry', () => {
    service.requestAuthorization({ clientId: 'cli' });
    expect(service.sweep()).toBe(0);
    clock += 21 * 60 * 1000;
    expect(service.sweep()).toBe(1);
  });
});
