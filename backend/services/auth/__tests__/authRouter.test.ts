import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { ApiKeyRotationService } from '../domain/ApiKeyRotationService';
import { ApiKeyRevocationService } from '../domain/ApiKeyRevocationService';
import { PasskeyService } from '../domain/PasskeyService';
import { PasskeyController } from '../controller/passkeyController';
import { ApiKeyRevocationController } from '../controller/apiKeyRevocationController';
import { createApiKeyRevocationRouter, createPasskeyRouter } from '../router/authRouter';
import { createApiKeyUsageMiddleware } from '../middleware/apiKeyUsageMiddleware';
import { ServerSessionService } from '../serverSessionService';
import { SoftwareAuthenticator } from './helpers/softwareAuthenticator';

const ORIGIN = 'http://localhost:8081';

describe('auth routers (HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  let sessions: ServerSessionService;
  let keys: ApiKeyRotationService;
  let revocation: ApiKeyRevocationService;

  beforeEach(async () => {
    sessions = new ServerSessionService();
    keys = new ApiKeyRotationService();
    revocation = new ApiKeyRevocationService(keys);

    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/auth',
      createPasskeyRouter({
        controller: new PasskeyController(
          new PasskeyService({ rpId: 'localhost', origins: [ORIGIN] })
        ),
        sessions,
      })
    );
    app.use(
      '/api/v1/api-keys',
      createApiKeyRevocationRouter(new ApiKeyRevocationController(revocation))
    );
    app.get('/protected', createApiKeyUsageMiddleware({ keys, revocation }), (_req, res) => {
      res.json({ ok: true, apiKey: res.locals.apiKey });
    });

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
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
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  }

  describe('passkeys', () => {
    it('registers a passkey for a signed-in user and logs in with it', async () => {
      const bootstrap = sessions.createSession({
        userId: 'user-1',
        req: { headers: { 'user-agent': 'jest' }, socket: {} } as never,
      });
      const auth = { 'x-session-token': bootstrap.token, 'user-agent': 'jest' };
      const authenticator = new SoftwareAuthenticator('ES256');

      const options = await call(
        'POST',
        '/api/v1/auth/passkeys/register/options',
        { userName: 'ada' },
        auth
      );
      expect(options.status).toBe(200);

      const registered = await call(
        'POST',
        '/api/v1/auth/passkeys/register/verify',
        { response: authenticator.register(options.body.data), deviceName: 'MacBook' },
        auth
      );
      expect(registered.status).toBe(201);
      expect(registered.body.data).toMatchObject({ userId: 'user-1', deviceName: 'MacBook' });

      const list = await call('GET', '/api/v1/auth/passkeys', undefined, auth);
      expect(list.body.data).toHaveLength(1);

      const loginOptions = await call('POST', '/api/v1/auth/passkeys/login/options', {});
      const login = await call('POST', '/api/v1/auth/passkeys/login/verify', {
        response: authenticator.assert(loginOptions.body.data),
      });

      expect(login.status).toBe(200);
      expect(login.body.data).toMatchObject({ userId: 'user-1', credentialId: authenticator.id });
      const token = login.headers.get('x-session-token');
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const validated = sessions.validateSession(token as string);
      expect(validated.session?.userId).toBe('user-1');
      expect(validated.session?.metadata).toMatchObject({ authMethod: 'passkey' });
    });

    it('requires a session to manage passkeys', async () => {
      const res = await call('POST', '/api/v1/auth/passkeys/register/options', { userName: 'ada' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');

      const bad = await call('GET', '/api/v1/auth/passkeys', undefined, {
        'x-session-token': 'nope',
      });
      expect(bad.status).toBe(401);
    });

    it('rejects a login with an unknown credential without issuing a session', async () => {
      const loginOptions = await call('POST', '/api/v1/auth/passkeys/login/options', {});
      const login = await call('POST', '/api/v1/auth/passkeys/login/verify', {
        response: new SoftwareAuthenticator('ES256').assert(loginOptions.body.data),
      });
      expect(login.status).toBe(404);
      expect(login.body.error.code).toBe('AUTH_PASSKEY_CREDENTIAL_NOT_FOUND');
      expect(login.headers.get('x-session-token')).toBeNull();
    });
  });

  describe('API key revocation', () => {
    it('auto-revokes a leaked key so the next request is rejected', async () => {
      const { rawKey, keyId } = await keys.registerKey('merchant-1');

      const before = await call('GET', '/protected', undefined, { 'x-api-key': rawKey });
      expect(before.status).toBe(200);
      expect(before.body.apiKey).toEqual({ keyId, merchantId: 'merchant-1' });

      const scan = await call('POST', '/api/v1/api-keys/leaks/scan', {
        content: `export SUBTRACKR_KEY=${rawKey}`,
        source: 'github:acme/app',
      });
      expect(scan.status).toBe(200);
      expect(scan.body.data.incidents[0]).toMatchObject({ keyId, status: 'auto_revoked' });

      const after = await call('GET', '/protected', undefined, { 'x-api-key': rawKey });
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('AUTH_API_KEY_REVOKED');

      const incidents = await call('GET', `/api/v1/api-keys/leaks/incidents?merchantId=merchant-1`);
      expect(incidents.body.data).toHaveLength(1);
      const audit = await call('GET', `/api/v1/api-keys/revocations/audit?keyId=${keyId}&limit=1`);
      expect(audit.body.data).toHaveLength(1);
    });

    it('revokes keys manually and maps domain errors to HTTP statuses', async () => {
      const { keyId } = await keys.registerKey('merchant-1');

      const revoked = await call('POST', `/api/v1/api-keys/${keyId}/revoke`, {
        actorId: 'admin-1',
      });
      expect(revoked.status).toBe(200);
      const again = await call('POST', `/api/v1/api-keys/${keyId}/revoke`, { actorId: 'admin-1' });
      expect(again.status).toBe(409);
      const missing = await call('POST', '/api/v1/api-keys/missing/revoke', { actorId: 'admin-1' });
      expect(missing.status).toBe(404);
      const invalid = await call('POST', `/api/v1/api-keys/${keyId}/revoke`, {});
      expect(invalid.status).toBe(422);
    });

    it('flags usage anomalies and lets an operator confirm or dismiss them', async () => {
      await call('PATCH', '/api/v1/api-keys/leaks/policy/merchant-1', { maxRequestsPerWindow: 1 });
      const { rawKey, keyId } = await keys.registerKey('merchant-1');

      await call('GET', '/protected', undefined, { 'x-api-key': rawKey });
      const flagged = await call('GET', '/protected', undefined, { 'x-api-key': rawKey });
      expect(flagged.status).toBe(200); // flagged for review, not revoked by default

      const open = await call('GET', `/api/v1/api-keys/leaks/incidents?keyId=${keyId}&status=open`);
      expect(open.body.data).toHaveLength(1);
      const incidentId = open.body.data[0].id;

      const dismissed = await call(
        'POST',
        `/api/v1/api-keys/leaks/incidents/${incidentId}/dismiss`,
        {
          actorId: 'security-1',
          reason: 'load test',
        }
      );
      expect(dismissed.body.data.status).toBe('dismissed');

      const reported = await call('POST', `/api/v1/api-keys/${keyId}/report-leak`, {
        actorId: 'merchant-admin',
      });
      expect(reported.status).toBe(201);
      const confirmed = await call(
        'POST',
        `/api/v1/api-keys/leaks/incidents/${reported.body.data.id}/confirm`,
        {
          actorId: 'security-1',
        }
      );
      // The default policy auto-revokes on manual reports, so the incident is already closed.
      expect(confirmed.body.data.status).toBe('auto_revoked');

      const policy = await call('GET', '/api/v1/api-keys/leaks/policy/merchant-1');
      expect(policy.body.data.maxRequestsPerWindow).toBe(1);
    });

    it('revokes all keys for a merchant', async () => {
      await keys.registerKey('merchant-9');
      await keys.registerKey('merchant-9');
      const res = await call('POST', '/api/v1/api-keys/merchants/merchant-9/revoke-all', {
        actorId: 'admin-1',
      });
      expect(res.body.data).toEqual({ merchantId: 'merchant-9', revoked: 2 });
    });

    it('rejects missing or unknown API keys in the middleware', async () => {
      expect((await call('GET', '/protected')).status).toBe(401);
      expect(
        (await call('GET', '/protected', undefined, { 'x-api-key': 'sk_unknown' })).status
      ).toBe(401);
    });
  });
});
