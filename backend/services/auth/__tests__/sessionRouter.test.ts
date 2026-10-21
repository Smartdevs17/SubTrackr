import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { ServerSessionService } from '../serverSessionService';
import { SessionTokenService } from '../domain/SessionTokenService';
import { PasswordCredentialService } from '../domain/PasswordCredentialService';
import {
  DeviceAuthorizationService,
  DEVICE_CODE_GRANT_TYPE,
} from '../domain/DeviceAuthorizationService';
import { PasskeyService } from '../domain/PasskeyService';
import { PasskeyController } from '../controller/passkeyController';
import { createPasskeyRouter } from '../router/authRouter';
import { createSessionRouter } from '../router/sessionRouter';
import { SoftwareAuthenticator } from './helpers/softwareAuthenticator';

const ORIGIN = 'http://localhost:8081';
const PASSWORD = 'correct horse battery staple';
// Every request comes from the same "device" so session device binding holds.
const DEVICE_HEADERS = { 'user-agent': 'jest-http', 'accept-language': 'en' };

describe('session, token and device-flow routes (HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  let sessions: ServerSessionService;
  let tokens: SessionTokenService;
  let passwords: PasswordCredentialService;
  let deviceFlow: DeviceAuthorizationService;
  let deviceClock: number;

  beforeEach(async () => {
    sessions = new ServerSessionService();
    tokens = new SessionTokenService({ sessions });
    passwords = new PasswordCredentialService({
      kdfParams: { memoryCost: 16, timeCost: 1, parallelism: 1, keyLen: 32 },
    });
    deviceClock = Date.now();
    deviceFlow = new DeviceAuthorizationService(
      {
        verificationUri: 'https://app.subtrackr.test/device',
        clients: {
          'subtrackr-cli': {
            name: 'SubTrackr CLI',
            allowedScopes: ['profile:read', 'subscriptions:read', 'sessions:read'],
          },
        },
      },
      () => deviceClock
    );

    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/auth',
      createPasskeyRouter({
        controller: new PasskeyController(
          new PasskeyService({ rpId: 'localhost', origins: [ORIGIN] })
        ),
        tokens,
      })
    );
    app.use('/api/v1/auth', createSessionRouter({ tokens, passwords, deviceFlow }));

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    tokens.dispose();
    await new Promise((resolve) => server.close(resolve));
  });

  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...DEVICE_HEADERS, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  }

  /** RFC 6749 clients POST application/x-www-form-urlencoded. */
  async function form(path: string, fields: Record<string, string>) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...DEVICE_HEADERS },
      body: new URLSearchParams(fields).toString(),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  }

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  /** An interactive session for `userId`, as if they had already signed in. */
  function signedIn(userId: string) {
    return tokens.issue({
      userId,
      req: { headers: DEVICE_HEADERS, socket: {} } as never,
      authMethod: 'password',
    });
  }

  async function passwordLogin(userId: string, password = PASSWORD) {
    return call('POST', '/api/v1/auth/login/password', { userId, password });
  }

  describe('password fallback (#1778)', () => {
    it('falls back to the password when passkey sign-in fails and issues the same token pair', async () => {
      const bootstrap = signedIn('ada');
      const set = await call(
        'PUT',
        '/api/v1/auth/password',
        { newPassword: PASSWORD },
        bearer(bootstrap.accessToken)
      );
      expect(set.status).toBe(200);

      // Passkey attempt with an authenticator the server does not know.
      const options = await call('POST', '/api/v1/auth/passkeys/login/options', {});
      const passkey = await call('POST', '/api/v1/auth/passkeys/login/verify', {
        response: new SoftwareAuthenticator('ES256').assert(options.body.data),
      });
      expect(passkey.status).toBe(404);
      expect(passkey.headers.get('x-session-token')).toBeNull();

      // Fallback: password.
      const login = await passwordLogin('ada');
      expect(login.status).toBe(200);
      expect(login.headers.get('cache-control')).toBe('no-store');
      expect(login.headers.get('x-session-token')).toMatch(/^[a-f0-9]{64}$/);
      expect(login.headers.get('x-refresh-token')).toMatch(/^rt_/);
      expect(login.body.data.session.scopes).toEqual(['*']);
      expect(JSON.stringify(login.body)).not.toContain(login.headers.get('x-refresh-token'));

      const list = await call(
        'GET',
        '/api/v1/auth/sessions',
        undefined,
        bearer(login.headers.get('x-session-token') as string)
      );
      expect(list.body.data.find((s: any) => s.current)).toMatchObject({ authMethod: 'password' });
    });

    it('rejects wrong passwords and unknown users identically, then locks out', async () => {
      passwords.setPassword('ada', PASSWORD);
      const wrong = await passwordLogin('ada', 'not the password');
      const unknown = await passwordLogin('nobody');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toEqual(unknown.body.error);
      expect(wrong.headers.get('x-session-token')).toBeNull();

      for (let i = 0; i < 3; i++) await passwordLogin('ada', 'not the password');
      const locked = await passwordLogin('ada', 'not the password');
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('requires the auth:manage scope to set a password', async () => {
      const unauthenticated = await call('PUT', '/api/v1/auth/password', { newPassword: PASSWORD });
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get('www-authenticate')).toContain('invalid_token');
    });
  });

  describe('passkey login issues a rotating refresh token (#1776 + #1778)', () => {
    it('registers a passkey, logs in with it and refreshes the session', async () => {
      const bootstrap = signedIn('grace');
      const auth = { 'x-session-token': bootstrap.accessToken };
      const authenticator = new SoftwareAuthenticator('ES256');
      const regOptions = await call(
        'POST',
        '/api/v1/auth/passkeys/register/options',
        { userName: 'grace' },
        auth
      );
      await call(
        'POST',
        '/api/v1/auth/passkeys/register/verify',
        { response: authenticator.register(regOptions.body.data) },
        auth
      );

      const options = await call('POST', '/api/v1/auth/passkeys/login/options', {});
      const login = await call('POST', '/api/v1/auth/passkeys/login/verify', {
        response: authenticator.assert(options.body.data),
      });
      expect(login.status).toBe(200);
      const refreshToken = login.headers.get('x-refresh-token') as string;
      expect(refreshToken).toMatch(/^rt_/);
      expect(login.body.data.session.refreshTokenExpiresAt).toBeGreaterThan(Date.now());

      const refreshed = await form('/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.refresh_token).not.toBe(refreshToken);
      expect(refreshed.body.access_token).not.toBe(login.headers.get('x-session-token'));
    });
  });

  describe('refresh-token rotation over HTTP (#1776)', () => {
    it('rotates on use and revokes the session when an old refresh token is replayed', async () => {
      passwords.setPassword('ada', PASSWORD);
      const login = await passwordLogin('ada');
      const access1 = login.headers.get('x-session-token') as string;
      const refresh1 = login.headers.get('x-refresh-token') as string;

      const rotated = await form('/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: refresh1,
      });
      expect(rotated.status).toBe(200);
      expect(rotated.headers.get('cache-control')).toBe('no-store');
      expect(rotated.body).toMatchObject({ token_type: 'Bearer', scope: '*' });
      expect(rotated.body.expires_in).toBeGreaterThan(0);
      const { access_token: access2, refresh_token: refresh2 } = rotated.body;

      // The previous access token is gone as soon as it is rotated.
      expect((await call('GET', '/api/v1/auth/sessions', undefined, bearer(access1))).status).toBe(
        401
      );
      expect((await call('GET', '/api/v1/auth/sessions', undefined, bearer(access2))).status).toBe(
        200
      );

      // Replay of the rotated refresh token → reuse detected → whole family revoked.
      const replay = await form('/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: refresh1,
      });
      expect(replay.status).toBe(400);
      expect(replay.body.error).toBe('invalid_grant');

      expect((await call('GET', '/api/v1/auth/sessions', undefined, bearer(access2))).status).toBe(
        401
      );
      const afterReuse = await form('/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: refresh2,
      });
      expect(afterReuse.body.error).toBe('invalid_grant');
    });

    it('validates token endpoint requests', async () => {
      expect((await form('/api/v1/auth/oauth/token', {})).body.error).toBe('invalid_request');
      expect((await form('/api/v1/auth/oauth/token', { grant_type: 'password' })).body.error).toBe(
        'unsupported_grant_type'
      );
      expect(
        (await form('/api/v1/auth/oauth/token', { grant_type: 'refresh_token' })).body.error
      ).toBe('invalid_request');
      const json = await call('POST', '/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: 'rt_bogus',
      });
      expect(json.status).toBe(400);
      expect(json.body.error).toBe('invalid_grant');
    });
  });

  describe('session listing and remote revocation (#1777)', () => {
    it('lists live sessions and revokes another one with immediate effect', async () => {
      passwords.setPassword('ada', PASSWORD);
      const phone = await passwordLogin('ada');
      const laptop = await passwordLogin('ada');
      const phoneAccess = phone.headers.get('x-session-token') as string;
      const laptopAccess = laptop.headers.get('x-session-token') as string;
      signedIn('someone-else');

      const list = await call('GET', '/api/v1/auth/sessions', undefined, bearer(laptopAccess));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(2);
      const current = list.body.data.find((s: any) => s.current);
      const other = list.body.data.find((s: any) => !s.current);
      expect(current.id).toBe(laptop.body.data.session.id);
      expect(other.id).toBe(phone.body.data.session.id);
      expect(JSON.stringify(list.body)).not.toContain(phoneAccess);

      // Phone still works before revocation …
      expect(
        (await call('GET', '/api/v1/auth/sessions', undefined, bearer(phoneAccess))).status
      ).toBe(200);

      const revoke = await call(
        'DELETE',
        `/api/v1/auth/sessions/${other.id}`,
        undefined,
        bearer(laptopAccess)
      );
      expect(revoke.status).toBe(200);
      expect(revoke.body.data).toMatchObject({ revoked: true, current: false });

      // … and is rejected on the very next request, refresh token included.
      expect(
        (await call('GET', '/api/v1/auth/sessions', undefined, bearer(phoneAccess))).status
      ).toBe(401);
      const refresh = await form('/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: phone.headers.get('x-refresh-token') as string,
      });
      expect(refresh.body.error).toBe('invalid_grant');

      const after = await call('GET', '/api/v1/auth/sessions', undefined, bearer(laptopAccess));
      expect(after.body.data.map((s: any) => s.id)).toEqual([current.id]);
    });

    it("returns 404 for another user's session and leaves it intact", async () => {
      const mine = signedIn('ada');
      const theirs = signedIn('mallory-victim');
      const res = await call(
        'DELETE',
        `/api/v1/auth/sessions/${theirs.session.id}`,
        undefined,
        bearer(mine.accessToken)
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AUTH_SESSION_NOT_FOUND');
      expect(sessions.validateSession(theirs.accessToken).valid).toBe(true);
    });

    it('signs out other sessions and logs out the current one', async () => {
      const a = signedIn('ada');
      const b = signedIn('ada');
      const c = signedIn('ada');
      const others = await call(
        'POST',
        '/api/v1/auth/sessions/revoke-others',
        {},
        bearer(a.accessToken)
      );
      expect(others.body.data.revoked).toBe(2);
      expect(sessions.validateSession(b.accessToken).valid).toBe(false);
      expect(sessions.validateSession(c.accessToken).valid).toBe(false);

      const logout = await call(
        'POST',
        '/api/v1/auth/logout',
        {},
        { 'x-session-token': a.accessToken }
      );
      expect(logout.status).toBe(200);
      expect(
        (await call('GET', '/api/v1/auth/sessions', undefined, bearer(a.accessToken))).status
      ).toBe(401);
    });
  });

  describe('OAuth device authorization flow (#1779)', () => {
    async function startDeviceFlow(scope = 'sessions:read subscriptions:read') {
      const res = await form('/api/v1/auth/oauth/device_authorization', {
        client_id: 'subtrackr-cli',
        scope,
      });
      expect(res.status).toBe(200);
      return res.body as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        verification_uri_complete: string;
        expires_in: number;
        interval: number;
      };
    }

    const pollToken = (deviceCode: string) =>
      form('/api/v1/auth/oauth/token', {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: 'subtrackr-cli',
      });

    it('runs the full flow and limits the issued token to the approved scopes', async () => {
      const device = await startDeviceFlow();
      expect(device).toMatchObject({
        verification_uri: 'https://app.subtrackr.test/device',
        expires_in: 600,
        interval: 5,
      });

      const pending = await pollToken(device.device_code);
      expect(pending.status).toBe(400);
      expect(pending.body.error).toBe('authorization_pending');

      deviceClock += 1000;
      expect((await pollToken(device.device_code)).body.error).toBe('slow_down');

      // The user, signed in elsewhere, reviews and approves a narrower grant.
      const user = signedIn('ada');
      const review = await call(
        'GET',
        `/api/v1/auth/oauth/device?user_code=${encodeURIComponent(device.user_code)}`,
        undefined,
        bearer(user.accessToken)
      );
      expect(review.body.data).toMatchObject({
        clientName: 'SubTrackr CLI',
        scopes: ['sessions:read', 'subscriptions:read'],
      });
      const approve = await call(
        'POST',
        '/api/v1/auth/oauth/device/approve',
        { user_code: device.user_code, scope: 'sessions:read' },
        bearer(user.accessToken)
      );
      expect(approve.status).toBe(200);
      expect(approve.body.data.grantedScopes).toEqual(['sessions:read']);

      deviceClock += 15_000;
      const granted = await pollToken(device.device_code);
      expect(granted.status).toBe(200);
      expect(granted.headers.get('cache-control')).toBe('no-store');
      expect(granted.body).toMatchObject({ token_type: 'Bearer', scope: 'sessions:read' });
      const deviceAccess = granted.body.access_token as string;

      // Device code is single-use.
      deviceClock += 15_000;
      expect((await pollToken(device.device_code)).body.error).toBe('invalid_grant');

      // Granted scope works …
      const list = await call('GET', '/api/v1/auth/sessions', undefined, bearer(deviceAccess));
      expect(list.status).toBe(200);
      expect(list.body.data.find((s: any) => s.current)).toMatchObject({
        authMethod: 'device_code',
        clientId: 'subtrackr-cli',
        scopes: ['sessions:read'],
      });

      // … everything else is refused with 403 insufficient_scope.
      const revoke = await call(
        'DELETE',
        `/api/v1/auth/sessions/${user.session.id}`,
        undefined,
        bearer(deviceAccess)
      );
      expect(revoke.status).toBe(403);
      expect(revoke.body.error.code).toBe('AUTH_INSUFFICIENT_SCOPE');
      expect(revoke.headers.get('www-authenticate')).toContain('insufficient_scope');

      const passkeys = await call('GET', '/api/v1/auth/passkeys', undefined, {
        'x-session-token': deviceAccess,
      });
      expect(passkeys.status).toBe(403);

      const secondDevice = await startDeviceFlow('profile:read');
      const chained = await call(
        'POST',
        '/api/v1/auth/oauth/device/approve',
        { user_code: secondDevice.user_code },
        bearer(deviceAccess)
      );
      expect(chained.status).toBe(403);

      // Refreshing a device token keeps the narrowed scope.
      const refreshed = await form('/api/v1/auth/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: granted.body.refresh_token,
      });
      expect(refreshed.body.scope).toBe('sessions:read');

      // The owner sees the device session and can revoke it remotely.
      const owner = await call('GET', '/api/v1/auth/sessions', undefined, bearer(user.accessToken));
      const cli = owner.body.data.find((s: any) => s.clientId === 'subtrackr-cli');
      await call('DELETE', `/api/v1/auth/sessions/${cli.id}`, undefined, bearer(user.accessToken));
      const afterRevoke = await call(
        'GET',
        '/api/v1/auth/sessions',
        undefined,
        bearer(refreshed.body.access_token)
      );
      expect(afterRevoke.status).toBe(401);
    });

    it('returns access_denied after the user denies', async () => {
      const device = await startDeviceFlow();
      const user = signedIn('ada');
      const deny = await call(
        'POST',
        '/api/v1/auth/oauth/device/deny',
        { user_code: device.user_code },
        bearer(user.accessToken)
      );
      expect(deny.status).toBe(200);
      const res = await pollToken(device.device_code);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('access_denied');
    });

    it('returns expired_token once the device code lapses', async () => {
      const device = await startDeviceFlow();
      deviceClock += 11 * 60 * 1000;
      expect((await pollToken(device.device_code)).body.error).toBe('expired_token');
    });

    it('rejects unknown clients and disallowed scopes', async () => {
      const unknown = await form('/api/v1/auth/oauth/device_authorization', { client_id: 'nope' });
      expect(unknown.status).toBe(401);
      expect(unknown.body.error).toBe('invalid_client');

      const scope = await form('/api/v1/auth/oauth/device_authorization', {
        client_id: 'subtrackr-cli',
        scope: 'sessions:write',
      });
      expect(scope.status).toBe(400);
      expect(scope.body.error).toBe('invalid_scope');
    });

    it('requires a signed-in user to approve', async () => {
      const device = await startDeviceFlow();
      const res = await call('POST', '/api/v1/auth/oauth/device/approve', {
        user_code: device.user_code,
      });
      expect(res.status).toBe(401);
    });
  });
});
