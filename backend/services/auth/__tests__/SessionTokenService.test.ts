import { ServerSessionService } from '../serverSessionService';
import { SessionTokenService, hashRefreshToken } from '../domain/SessionTokenService';
import { AuthErrorCode } from '../errors';
import { eventBus } from '../../shared/events';

function req(userAgent = 'jest-device', ip = '10.0.0.1') {
  return {
    headers: { 'user-agent': userAgent, 'x-forwarded-for': ip },
    socket: {},
  } as never;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('SessionTokenService', () => {
  let sessions: ServerSessionService;
  let tokens: SessionTokenService;
  let clock: number;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    sessions = new ServerSessionService();
    tokens = new SessionTokenService({ sessions });
  });

  afterEach(() => {
    tokens.dispose();
    jest.restoreAllMocks();
  });

  describe('issue', () => {
    it('creates a session with a refresh-token family and stores only the hash', () => {
      const issued = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });

      expect(issued.accessToken).toMatch(/^[a-f0-9]{64}$/);
      expect(issued.refreshToken).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);
      expect(issued.scopes).toEqual(['*']);
      expect(issued.session.metadata).toMatchObject({ authMethod: 'password' });
      expect(issued.family.currentTokenHash).toBe(hashRefreshToken(issued.refreshToken));
      expect(JSON.stringify(issued.family)).not.toContain(issued.refreshToken);
      expect(sessions.validateSession(issued.accessToken).valid).toBe(true);
    });

    it('limits device-flow sessions to the granted scopes', () => {
      const issued = tokens.issue({
        userId: 'u1',
        req: req(),
        authMethod: 'device_code',
        scopes: ['subscriptions:read'],
        clientId: 'subtrackr-cli',
      });
      expect(issued.session.scopes).toEqual(['subscriptions:read']);
      expect(issued.family.clientId).toBe('subtrackr-cli');
    });
  });

  describe('rotation on use', () => {
    it('returns a new refresh token and a new access token, invalidating the old pair', () => {
      const first = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      clock += 60_000;
      const second = tokens.refresh(first.refreshToken, req());

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).not.toBe(first.accessToken);
      expect(second.session.id).toBe(first.session.id);
      expect(second.family.generation).toBe(2);
      expect(sessions.validateSession(first.accessToken).valid).toBe(false);
      expect(sessions.validateSession(second.accessToken).valid).toBe(true);

      const third = tokens.refresh(second.refreshToken, req());
      expect(third.family.generation).toBe(3);
    });

    it('revives a session whose access token expired while the refresh token is valid', () => {
      const first = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      clock += 2 * 60 * 60 * 1000; // access TTL is 30 min
      expect(sessions.validateSession(first.accessToken).valid).toBe(false);

      const next = tokens.refresh(first.refreshToken, req());
      expect(sessions.validateSession(next.accessToken).valid).toBe(true);
      expect(next.expiresIn).toBe(30 * 60);
    });

    it('preserves scopes across rotation', () => {
      const first = tokens.issue({
        userId: 'u1',
        req: req(),
        authMethod: 'device_code',
        scopes: ['sessions:read'],
      });
      expect(tokens.refresh(first.refreshToken, req()).scopes).toEqual(['sessions:read']);
    });

    it('refuses rotation from a different device without consuming the token', () => {
      const first = tokens.issue({ userId: 'u1', req: req('laptop'), authMethod: 'password' });
      expect(codeOf(() => tokens.refresh(first.refreshToken, req('attacker')))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
      // The legitimate device can still rotate.
      expect(tokens.refresh(first.refreshToken, req('laptop')).family.generation).toBe(2);
    });
  });

  describe('reuse detection', () => {
    it('revokes the whole family and the session when a rotated token is replayed', async () => {
      const published: string[] = [];
      jest.spyOn(eventBus, 'publish').mockImplementation(async (event) => {
        published.push(event.name);
      });

      const first = tokens.issue({ userId: 'u1', req: req(), authMethod: 'passkey' });
      const second = tokens.refresh(first.refreshToken, req());

      // Attacker (or a confused client) replays the already-rotated token.
      expect(codeOf(() => tokens.refresh(first.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_REUSED
      );

      // Everything in the family is dead, including the newest tokens.
      expect(sessions.validateSession(second.accessToken).reason).toBe('session_revoked');
      expect(codeOf(() => tokens.refresh(second.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
      expect(tokens.getFamilyForSession(first.session.id)).toMatchObject({
        status: 'revoked',
        revokedReason: 'reuse_detected',
      });
      expect(tokens.getAuditLog({ userId: 'u1' }).map((e) => e.action)).toEqual(
        expect.arrayContaining(['issued', 'rotated', 'reuse_detected', 'revoked'])
      );
      expect(published).toContain('auth.refresh_token_reuse_detected');
    });

    it('does not affect other sessions of the same user', () => {
      const a = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      const b = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      tokens.refresh(a.refreshToken, req());
      codeOf(() => tokens.refresh(a.refreshToken, req()));

      expect(sessions.validateSession(b.accessToken).valid).toBe(true);
      expect(tokens.refresh(b.refreshToken, req()).family.generation).toBe(2);
    });

    it('keeps the revocation when an event subscriber fails', async () => {
      jest.spyOn(eventBus, 'publish').mockRejectedValue(new Error('bus down'));
      const first = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      const second = tokens.refresh(first.refreshToken, req());
      expect(codeOf(() => tokens.refresh(first.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_REUSED
      );
      await Promise.resolve();
      expect(sessions.validateSession(second.accessToken).valid).toBe(false);
    });
  });

  describe('rejection', () => {
    it('rejects malformed and unknown tokens', () => {
      expect(codeOf(() => tokens.refresh('nope', req()))).toBe(AuthErrorCode.REFRESH_TOKEN_INVALID);
      expect(codeOf(() => tokens.refresh('rt_unknown', req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
    });

    it('expires idle refresh tokens and caps the family lifetime', () => {
      const idle = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      clock += 8 * 24 * 60 * 60 * 1000;
      expect(codeOf(() => tokens.refresh(idle.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );

      const active = tokens.issue({ userId: 'u2', req: req(), authMethod: 'password' });
      let current = active.refreshToken;
      for (let day = 0; day < 29; day++) {
        clock += 24 * 60 * 60 * 1000;
        current = tokens.refresh(current, req()).refreshToken;
      }
      clock += 2 * 24 * 60 * 60 * 1000; // past the 30-day absolute cap
      expect(codeOf(() => tokens.refresh(current, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
    });

    it('rejects the refresh token once the session is revoked by any path', () => {
      const viaLogout = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      sessions.revokeSession(viaLogout.accessToken, 'user_logout');
      expect(codeOf(() => tokens.refresh(viaLogout.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );

      const viaRevokeAll = tokens.issue({ userId: 'u2', req: req(), authMethod: 'password' });
      sessions.revokeAllSessions('u2');
      expect(codeOf(() => tokens.refresh(viaRevokeAll.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
    });

    it('revokes an idle session whose access token already expired', () => {
      const issued = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      clock += 60 * 60 * 1000;
      sessions.validateSession(issued.accessToken); // marks the access token expired
      expect(tokens.revokeSession('u1', issued.session.id)).toBe(true);
      expect(codeOf(() => tokens.refresh(issued.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
    });
  });

  describe('listing and revocation', () => {
    it('lists exactly the sessions that can still be used, newest first', () => {
      const a = tokens.issue({ userId: 'u1', req: req('phone'), authMethod: 'passkey' });
      clock += 1000;
      const b = tokens.issue({
        userId: 'u1',
        req: req('cli'),
        authMethod: 'device_code',
        scopes: ['sessions:read'],
        clientId: 'subtrackr-cli',
      });
      clock += 1000;
      const c = tokens.issue({ userId: 'u1', req: req('laptop'), authMethod: 'password' });
      tokens.issue({ userId: 'someone-else', req: req(), authMethod: 'password' });
      tokens.revokeSession('u1', c.session.id);

      const list = tokens.listSessions('u1', a.session.id);
      expect(list.map((s) => s.id)).toEqual([b.session.id, a.session.id]);
      expect(list[0]).toMatchObject({
        authMethod: 'device_code',
        clientId: 'subtrackr-cli',
        scopes: ['sessions:read'],
        current: false,
      });
      expect(list[1]).toMatchObject({ authMethod: 'passkey', current: true });
      expect(JSON.stringify(list)).not.toContain(a.accessToken);
    });

    it('keeps listing a session whose access token lapsed but whose refresh token is live', () => {
      const issued = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      clock += 60 * 60 * 1000;
      expect(tokens.listSessions('u1').map((s) => s.id)).toEqual([issued.session.id]);
      clock += 8 * 24 * 60 * 60 * 1000;
      expect(tokens.listSessions('u1')).toEqual([]);
    });

    it("does not let a user revoke someone else's session", () => {
      const victim = tokens.issue({ userId: 'victim', req: req(), authMethod: 'password' });
      expect(tokens.revokeSession('attacker', victim.session.id)).toBe(false);
      expect(sessions.validateSession(victim.accessToken).valid).toBe(true);
    });

    it('revokes every other session', () => {
      const keep = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      const other1 = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      const other2 = tokens.issue({ userId: 'u1', req: req(), authMethod: 'passkey' });
      expect(tokens.revokeOtherSessions('u1', keep.session.id)).toBe(2);
      expect(sessions.validateSession(keep.accessToken).valid).toBe(true);
      expect(sessions.validateSession(other1.accessToken).valid).toBe(false);
      expect(codeOf(() => tokens.refresh(other2.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
    });

    it('revokes the family of a session evicted by the concurrent-session limit', () => {
      const limited = new ServerSessionService({ maxConcurrentSessions: 1 });
      const limitedTokens = new SessionTokenService({ sessions: limited });
      const first = limitedTokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      limitedTokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
      expect(codeOf(() => limitedTokens.refresh(first.refreshToken, req()))).toBe(
        AuthErrorCode.REFRESH_TOKEN_INVALID
      );
      limitedTokens.dispose();
    });
  });

  it('sweeps dead families after their absolute lifetime', () => {
    const issued = tokens.issue({ userId: 'u1', req: req(), authMethod: 'password' });
    tokens.revokeSession('u1', issued.session.id);
    expect(tokens.sweep()).toBe(0);
    clock += 31 * 24 * 60 * 60 * 1000;
    expect(tokens.sweep()).toBe(1);
    expect(tokens.getFamilyForSession(issued.session.id)).toBeUndefined();
  });
});
