import {
  LoginAnomalyService,
  calculateHaversineDistanceKm,
  type LoginAnomalyAlert,
} from '../domain/LoginAnomalyService';

describe('LoginAnomalyService', () => {
  let service: LoginAnomalyService;

  beforeEach(() => {
    service = new LoginAnomalyService();
  });

  describe('Haversine distance formula', () => {
    it('calculates distance between London and Paris accurately', () => {
      // London: 51.5074, -0.1278; Paris: 48.8566, 2.3522 (~340 km)
      const distance = calculateHaversineDistanceKm(51.5074, -0.1278, 48.8566, 2.3522);
      expect(Math.round(distance)).toBeGreaterThan(330);
      expect(Math.round(distance)).toBeLessThan(360);
    });
  });

  describe('Impossible Travel Heuristic', () => {
    it('detects impossible travel across continents within 1 hour', async () => {
      const now = Date.now();
      // First login in New York (lat: 40.7128, lon: -74.0060)
      await service.evaluateLogin({
        userId: 'user-123',
        ip: '198.51.100.1',
        deviceFingerprint: 'dev-1',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
        geo: { lat: 40.7128, lon: -74.0060, city: 'New York' },
      });

      // Second login 30 minutes later in Tokyo (lat: 35.6762, lon: 139.6503, ~10,800 km away)
      const result = await service.evaluateLogin({
        userId: 'user-123',
        ip: '203.0.113.1',
        deviceFingerprint: 'dev-1',
        userAgent: 'Mozilla/5.0',
        timestamp: now + 30 * 60 * 1000,
        geo: { lat: 35.6762, lon: 139.6503, city: 'Tokyo' },
      });

      expect(result.isAnomalous).toBe(true);
      expect(result.triggeredHeuristics).toContain('impossible_travel');
      expect(result.severity).toBe('critical');
      expect(result.alert).toBeDefined();
    });
  });

  describe('Unrecognized Device Heuristic', () => {
    it('flags an unrecognized device after a known device exists', async () => {
      const now = Date.now();
      // Baseline login from device-A
      await service.evaluateLogin({
        userId: 'user-456',
        ip: '192.0.2.1',
        deviceFingerprint: 'device-fingerprint-A',
        userAgent: 'Chrome on MacOS',
        timestamp: now,
      });

      // Login from completely new device-B
      const result = await service.evaluateLogin({
        userId: 'user-456',
        ip: '192.0.2.1',
        deviceFingerprint: 'device-fingerprint-B',
        userAgent: 'Firefox on Linux',
        timestamp: now + 60 * 1000,
      });

      expect(result.triggeredHeuristics).toContain('unrecognized_device');
    });
  });

  describe('Failed Attempts Burst Heuristic', () => {
    it('detects preceding burst of failed login attempts', async () => {
      const now = Date.now();
      // Record 3 failed attempts
      service.recordFailedLogin({
        userId: 'user-789',
        ip: '198.51.100.5',
        deviceFingerprint: 'dev-fail',
        userAgent: 'Mozilla/5.0',
        timestamp: now - 60_000,
      });
      service.recordFailedLogin({
        userId: 'user-789',
        ip: '198.51.100.5',
        deviceFingerprint: 'dev-fail',
        userAgent: 'Mozilla/5.0',
        timestamp: now - 40_000,
      });
      service.recordFailedLogin({
        userId: 'user-789',
        ip: '198.51.100.5',
        deviceFingerprint: 'dev-fail',
        userAgent: 'Mozilla/5.0',
        timestamp: now - 20_000,
      });

      // Now successful login
      const result = await service.evaluateLogin({
        userId: 'user-789',
        ip: '198.51.100.5',
        deviceFingerprint: 'dev-fail',
        userAgent: 'Mozilla/5.0',
        timestamp: now,
      });

      expect(result.triggeredHeuristics).toContain('failed_attempts_burst');
    });
  });

  describe('Alerts Emitted & Tunable Configuration', () => {
    it('emits alerts to registered listeners and stores in history', async () => {
      const receivedAlerts: LoginAnomalyAlert[] = [];
      service.onAlert((alert) => {
        receivedAlerts.push(alert);
      });

      const now = Date.now();
      await service.evaluateLogin({
        userId: 'user-alert',
        ip: '10.0.0.1',
        deviceFingerprint: 'dev-1',
        userAgent: 'Agent1',
        timestamp: now,
        geo: { lat: 0, lon: 0 },
      });

      await service.evaluateLogin({
        userId: 'user-alert',
        ip: '10.0.0.2',
        deviceFingerprint: 'dev-2',
        userAgent: 'Agent2',
        timestamp: now + 60 * 1000,
        geo: { lat: 45, lon: 45 }, // massive jump in 1 minute
      });

      expect(receivedAlerts.length).toBeGreaterThan(0);
      const alerts = service.getAlerts('user-alert');
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].userId).toBe('user-alert');
    });

    it('tunes thresholds dynamically via updateConfig', async () => {
      service.updateConfig({ riskThreshold: 0.9 });
      expect(service.getConfig().riskThreshold).toBe(0.9);

      // Invalid threshold rejected
      expect(() => service.updateConfig({ riskThreshold: 1.5 })).toThrow('riskThreshold must be between 0 and 1');
    });

    it('bypasses anomaly detection when disabled', async () => {
      service.updateConfig({ enabled: false });
      const now = Date.now();
      const result = await service.evaluateLogin({
        userId: 'user-disabled',
        ip: '10.0.0.1',
        deviceFingerprint: 'dev-1',
        userAgent: 'Agent1',
        timestamp: now,
        geo: { lat: 0, lon: 0 },
      });

      expect(result.isAnomalous).toBe(false);
      expect(result.riskScore).toBe(0);
    });
  });
});
