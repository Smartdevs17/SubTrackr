import { ApiKeyRotationService } from '../domain/ApiKeyRotationService';
import { ApiKeyRevocationService } from '../domain/ApiKeyRevocationService';
import { PasskeyService } from '../domain/PasskeyService';
import { ApiKeyRevocationController } from '../controller/apiKeyRevocationController';
import { PasskeyController } from '../controller/passkeyController';
import { SoftwareAuthenticator } from './helpers/softwareAuthenticator';

describe('PasskeyController', () => {
  let controller: PasskeyController;
  let authenticator: SoftwareAuthenticator;

  beforeEach(() => {
    controller = new PasskeyController(
      new PasskeyService({ rpId: 'localhost', origins: ['http://localhost:8081'] })
    );
    authenticator = new SoftwareAuthenticator('ES256');
  });

  async function registerPasskey() {
    const options = await controller.registrationOptions(
      { userId: 'user-1', userName: 'ada' },
      'req-1'
    );
    if (!options.success) throw new Error('expected options');
    return controller.verifyRegistration({
      userId: 'user-1',
      response: authenticator.register(options.data),
      deviceName: 'Phone',
    });
  }

  it('runs the registration and login ceremonies end to end', async () => {
    const registered = await registerPasskey();
    expect(registered.success).toBe(true);
    if (!registered.success) return;
    expect(registered.data).not.toHaveProperty('publicKey');
    expect(registered.data.deviceName).toBe('Phone');

    const options = await controller.authenticationOptions({ userId: 'user-1' }, 'req-2');
    if (!options.success) throw new Error('expected options');
    const login = await controller.verifyAuthentication(
      { response: authenticator.assert(options.data) },
      'req-3'
    );

    expect(login).toMatchObject({
      success: true,
      data: { userId: 'user-1', credentialId: authenticator.id },
    });
    expect(login.meta.requestId).toBe('req-3');
  });

  it('validates required fields', async () => {
    expect(await controller.registrationOptions({ userId: 'user-1' })).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(await controller.verifyRegistration({ userId: 'user-1' })).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(await controller.verifyAuthentication({})).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('maps verification failures to passkey error codes', async () => {
    const options = await controller.authenticationOptions({});
    if (!options.success) throw new Error('expected options');
    const result = await controller.verifyAuthentication({
      response: authenticator.assert(options.data),
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: 'AUTH_PASSKEY_CREDENTIAL_NOT_FOUND' },
    });
  });

  it('lists and removes credentials', async () => {
    await registerPasskey();
    const list = await controller.listCredentials('user-1');
    expect(list.success && list.data.map((c) => c.id)).toEqual([authenticator.id]);

    expect(await controller.removeCredential('user-1', authenticator.id)).toMatchObject({
      success: true,
      data: { removed: true },
    });
    expect(await controller.removeCredential('user-1', authenticator.id)).toMatchObject({
      success: false,
      error: { code: 'AUTH_PASSKEY_CREDENTIAL_NOT_FOUND' },
    });
  });
});

describe('ApiKeyRevocationController', () => {
  let keys: ApiKeyRotationService;
  let service: ApiKeyRevocationService;
  let controller: ApiKeyRevocationController;

  beforeEach(() => {
    keys = new ApiKeyRotationService();
    service = new ApiKeyRevocationService(keys);
    controller = new ApiKeyRevocationController(service);
  });

  it('revokes a key', async () => {
    const { keyId } = await keys.registerKey('merchant-1');
    const result = await controller.revoke(
      keyId,
      { actorId: 'admin-1', reason: 'rotated_out' },
      'req-1'
    );
    expect(result).toMatchObject({ success: true, data: { keyId, status: 'revoked' } });
    expect(keys.getKey(keyId)?.revocationReason).toBe('rotated_out');
  });

  it('returns domain error codes for failures', async () => {
    expect(await controller.revoke('missing', { actorId: 'admin-1' })).toMatchObject({
      success: false,
      error: { code: 'AUTH_API_KEY_NOT_FOUND' },
    });
    expect(await controller.revoke('missing', {})).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(await controller.confirmIncident('missing', { actorId: 'a' })).toMatchObject({
      success: false,
      error: { code: 'AUTH_LEAK_INCIDENT_NOT_FOUND' },
    });
  });

  it('revokes all keys for a merchant', async () => {
    await keys.registerKey('merchant-1');
    await keys.registerKey('merchant-1');
    expect(await controller.revokeAll('merchant-1', { actorId: 'admin-1' })).toMatchObject({
      success: true,
      data: { merchantId: 'merchant-1', revoked: 2 },
    });
    expect(await controller.revokeAll('merchant-1', {})).toMatchObject({ success: false });
  });

  it('scans content and hashes in one request', async () => {
    const a = await keys.registerKey('merchant-1');
    const result = await controller.scan({
      content: `key=${a.rawKey}`,
      hashes: ['0'.repeat(64)],
      source: 'ci-logs',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scannedCandidates).toBe(2);
    expect(result.data.incidents).toHaveLength(1);

    expect(await controller.scan({})).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(await controller.scan({ hashes: 'x' as unknown as string[] })).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('manages incidents through report, list, dismiss and confirm', async () => {
    await controller.updatePolicy('merchant-1', { autoRevokeOnExposure: false });
    const { keyId } = await keys.registerKey('merchant-1');

    const reported = await controller.reportLeak(keyId, {
      actorId: 'merchant-admin',
      source: 'email',
    });
    if (!reported.success) throw new Error('expected incident');
    const listed = await controller.listIncidents({ merchantId: 'merchant-1', status: 'open' });
    expect(listed.success && listed.data).toHaveLength(1);

    const dismissed = await controller.dismissIncident(reported.data.id, { actorId: 'security-1' });
    expect(dismissed).toMatchObject({ success: true, data: { status: 'dismissed' } });
    expect(
      await controller.dismissIncident(reported.data.id, { actorId: 'security-1' })
    ).toMatchObject({
      success: false,
      error: { code: 'AUTH_LEAK_INCIDENT_CLOSED' },
    });

    const second = await controller.reportLeak(keyId, { actorId: 'merchant-admin' });
    if (!second.success) throw new Error('expected incident');
    expect(
      await controller.confirmIncident(second.data.id, { actorId: 'security-1' })
    ).toMatchObject({
      success: true,
      data: { status: 'revoked' },
    });

    const audit = await controller.getAuditLog({ keyId });
    expect(audit.success && audit.data.map((e) => e.action)).toEqual([
      'revoked',
      'leak_detected',
      'incident_dismissed',
      'leak_detected',
    ]);
  });

  it('reads and validates the leak detection policy', async () => {
    expect(await controller.getPolicy('merchant-1')).toMatchObject({
      success: true,
      data: { autoRevokeOnExposure: true },
    });
    expect(await controller.updatePolicy('merchant-1', { maxRequestsPerWindow: -1 })).toMatchObject(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR' },
      }
    );
  });
});
