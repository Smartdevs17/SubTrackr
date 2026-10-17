import type { IncomingMessage } from 'node:http';
import { ServerSessionService } from '../serverSessionService';

const req = (userAgent: string, acceptLanguage = 'en-US'): IncomingMessage =>
  ({
    headers: { 'user-agent': userAgent, 'accept-language': acceptLanguage },
    socket: { remoteAddress: '203.0.113.7' },
  }) as unknown as IncomingMessage;

describe('session device binding (issue #1766)', () => {
  let service: ServerSessionService;

  beforeEach(() => {
    service = new ServerSessionService();
  });

  describe('binding enforced', () => {
    it('validates a session presented from the bound device', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      const result = service.validateSession(session.token, req('iPhone-UA'));

      expect(result.valid).toBe(true);
      expect(result.session?.device.fingerprint).toBe(session.device.fingerprint);
    });

    it('rejects a session replayed from a different device', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      const result = service.validateSession(session.token, req('Attacker-Curl/8.0'));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('device_binding_mismatch');
      expect(result.session?.id).toBe(session.id);
    });

    it('treats a changed Accept-Language as a different device', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA', 'en-US') });

      expect(service.validateSession(session.token, req('iPhone-UA', 'fr-FR')).valid).toBe(false);
      expect(service.validateSession(session.token, req('iPhone-UA', 'en-US')).valid).toBe(true);
    });

    it('records the mismatch in the audit log', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      service.validateSession(session.token, req('Thief-UA'));

      const log = service.getAuditLog({ sessionId: session.id });
      const flagged = log.find((e) => e.detail?.includes('device_binding_mismatch'));
      expect(flagged).toBeDefined();
    });

    it('still enforces the other validation reasons first', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      service.revokeSession(session.token, 'logout');

      const result = service.validateSession(session.token, req('Thief-UA'));
      expect(result.reason).toBe('session_revoked');
    });
  });

  describe('graceful fallback: warn and off modes', () => {
    it('warn mode flags but still validates the request', () => {
      service.updateConfig({ deviceBinding: 'warn' });
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      const result = service.validateSession(session.token, req('Thief-UA'));

      expect(result.valid).toBe(true);
      expect(result.session?.isSuspicious).toBe(true);
      expect(result.session?.suspiciousReasons).toContain('device_mismatch');
    });

    it('warn mode does not duplicate the mismatch flag', () => {
      service.updateConfig({ deviceBinding: 'warn' });
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      service.validateSession(session.token, req('Thief-UA'));
      service.validateSession(session.token, req('Thief-UA'));

      const flags = (session.suspiciousReasons ?? []).filter((r) => r === 'device_mismatch');
      expect(flags).toHaveLength(1);
    });

    it('off mode skips the check entirely', () => {
      service.updateConfig({ deviceBinding: 'off' });
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      const result = service.validateSession(session.token, req('Thief-UA'));

      expect(result.valid).toBe(true);
      expect(result.session?.isSuspicious).toBe(false);
    });

    it('validates without a request (no headers to compare)', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      expect(service.validateSession(session.token).valid).toBe(true);
    });
  });

  describe('rebind flow', () => {
    it('refuses to rebind without step-up authentication', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      const result = service.rebindSession(session.token, req('New-UA'));

      expect(result).toMatchObject({ rebound: false, reason: 'step_up_required' });
      // Binding unchanged — the mismatch still rejects.
      expect(service.validateSession(session.token, req('New-UA')).valid).toBe(false);
      expect(
        service.getAuditLog({ sessionId: session.id }).some((e) =>
          e.detail?.includes('without step-up')
        )
      ).toBe(true);
    });

    it('rebinds after step-up and moves validation to the new device', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      expect(service.validateSession(session.token, req('New-UA')).valid).toBe(false);

      const result = service.rebindSession(session.token, req('New-UA'), {
        reauthenticated: true,
      });

      expect(result.rebound).toBe(true);
      expect(result.session?.device.userAgent).toBe('New-UA');
      expect(service.validateSession(session.token, req('New-UA')).valid).toBe(true);
      // The old device no longer matches either.
      expect(service.validateSession(session.token, req('iPhone-UA')).valid).toBe(false);
    });

    it('learns the rebound device for future new-device detection', () => {
      service.createSession({ userId: 'user-1', req: req('Device-A') });
      const second = service.createSession({ userId: 'user-1', req: req('Device-B') });
      service.rebindSession(second.token, req('Device-C'), { reauthenticated: true });

      const third = service.createSession({ userId: 'user-1', req: req('Device-C') });
      expect(third.device.isKnownDevice).toBe(true);
      expect(third.suspiciousReasons).not.toContain('new_device');
    });

    it('clears a pending device_mismatch flag once rebound', () => {
      service.updateConfig({ deviceBinding: 'warn' });
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      service.validateSession(session.token, req('New-UA'));
      expect(session.suspiciousReasons).toContain('device_mismatch');

      service.rebindSession(session.token, req('New-UA'), { reauthenticated: true });

      expect(session.suspiciousReasons).not.toContain('device_mismatch');
      expect(session.isSuspicious).toBe(false);
    });

    it('is a no-op when the device has not changed', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });

      const result = service.rebindSession(session.token, req('iPhone-UA'), {
        reauthenticated: true,
      });

      expect(result).toMatchObject({ rebound: false, reason: 'same_device' });
    });

    it('reports missing, revoked and expired sessions distinctly', () => {
      expect(service.rebindSession('nope', req('UA'), { reauthenticated: true }).reason).toBe(
        'session_not_found'
      );

      const revoked = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      service.revokeSession(revoked.token, 'logout');
      expect(
        service.rebindSession(revoked.token, req('UA'), { reauthenticated: true }).reason
      ).toBe('session_revoked');

      const expired = service.createSession({
        userId: 'user-2',
        req: req('iPhone-UA'),
        ttlMs: -1,
      });
      expect(
        service.rebindSession(expired.token, req('UA'), { reauthenticated: true }).reason
      ).toBe('session_expired');
    });

    it('writes a rebound audit entry with the device transition', () => {
      const session = service.createSession({ userId: 'user-1', req: req('iPhone-UA') });
      const before = session.device.fingerprint;

      service.rebindSession(session.token, req('New-UA'), { reauthenticated: true });

      const entry = service.getAuditLog({ sessionId: session.id }).find((e) => e.action === 'rebound');
      expect(entry).toBeDefined();
      expect(entry?.detail).toContain(before);
      expect(entry?.detail).toContain(session.device.fingerprint);
    });
  });
});
