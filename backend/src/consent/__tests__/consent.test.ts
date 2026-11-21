/**
 * backend/src/consent/__tests__/consent.test.ts
 *
 * Unit tests for the GDPR/CCPA Consent Management subsystem.
 */

import {
  ConsentManager,
  CURRENT_POLICY_VERSION,
  InMemoryConsentRepository,
  StructuredConsentTelemetry,
  type ConsentCategory,
} from '../index';

describe('Consent Management Subsystem', () => {
  let repo: InMemoryConsentRepository;
  let telemetry: StructuredConsentTelemetry;
  let manager: ConsentManager;
  let clockTime: number;

  beforeEach(() => {
    repo = new InMemoryConsentRepository();
    telemetry = new StructuredConsentTelemetry();
    clockTime = 1_700_000_000_000;
    manager = new ConsentManager({
      repository: repo,
      metrics: telemetry,
      now: () => new Date(clockTime),
      policyVersion: '2026-11-01',
      secretKey: 'test-secret-key-12345',
    });
  });

  describe('Initial / Default Consent State', () => {
    it('returns default state with essential=true and all optional categories=false', async () => {
      const state = await manager.getConsent('user-1');
      expect(state.userId).toBe('user-1');
      expect(state.policyVersion).toBe('2026-11-01');
      expect(state.preferences.essential).toBe(true);
      expect(state.preferences.analytics).toBe(false);
      expect(state.preferences.marketing).toBe(false);
      expect(state.preferences.notifications).toBe(false);
      expect(state.preferences.data_sharing).toBe(false);
      expect(state.recordCount).toBe(0);
    });

    it('requires re-consent if user has never saved preferences', async () => {
      const needs = await manager.requiresReconsent('user-1');
      expect(needs).toBe(true);
    });
  });

  describe('Consent Updates & Audit Logging', () => {
    it('records consent grants with immutable audit trail and signatures', async () => {
      const state = await manager.updateConsent({
        userId: 'user-1',
        source: 'mobile_app',
        preferences: { analytics: true, notifications: true },
        ipAddress: '198.51.100.42',
      });

      expect(state.preferences.analytics).toBe(true);
      expect(state.preferences.notifications).toBe(true);
      expect(state.preferences.marketing).toBe(false);
      expect(state.recordCount).toBe(2);

      const history = await repo.getHistory('user-1');
      expect(history).toHaveLength(2);
      expect(history[0].status).toBe('granted');
      expect(history[0].signature).toBeDefined();
      expect(manager.verifyRecordIntegrity(history[0])).toBe(true);

      const metrics = telemetry.getSnapshot();
      expect(metrics.grants['analytics:mobile_app']).toBe(1);
      expect(metrics.grants['notifications:mobile_app']).toBe(1);
    });

    it('does not allow revoking the essential category', async () => {
      const state = await manager.updateConsent({
        userId: 'user-1',
        source: 'web_portal',
        preferences: { essential: false as any, analytics: true },
      });

      expect(state.preferences.essential).toBe(true);
      expect(state.preferences.analytics).toBe(true);
    });

    it('detects record tampering when signature does not match', async () => {
      await manager.updateConsent({
        userId: 'user-1',
        source: 'mobile_app',
        preferences: { marketing: true },
      });

      const history = await repo.getHistory('user-1');
      const tamperedRecord = { ...history[0], status: 'withdrawn' as const };

      expect(manager.verifyRecordIntegrity(tamperedRecord)).toBe(false);
      const metrics = telemetry.getSnapshot();
      expect(metrics.verificationFailures).toBe(1);
    });

    it('triggers event listeners when consent changes', async () => {
      const events: Array<{ category: ConsentCategory; granted: boolean }> = [];
      const unsubscribe = manager.onConsentChanged((ev) => {
        events.push({ category: ev.category, granted: ev.granted });
      });

      await manager.updateConsent({
        userId: 'user-1',
        source: 'api',
        preferences: { analytics: true },
      });

      expect(events).toEqual([{ category: 'analytics', granted: true }]);

      // Withdraw analytics
      await manager.updateConsent({
        userId: 'user-1',
        source: 'api',
        preferences: { analytics: false },
      });

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ category: 'analytics', granted: false });

      unsubscribe();
      await manager.updateConsent({
        userId: 'user-1',
        source: 'api',
        preferences: { analytics: true },
      });
      expect(events).toHaveLength(2); // No new events after unsubscribe
    });
  });

  describe('Bulk Actions & GDPR Art. 7(3) Withdrawal', () => {
    it('withdrawAll sets all optional categories to false immediately', async () => {
      await manager.updateConsent({
        userId: 'user-1',
        source: 'mobile_app',
        preferences: { analytics: true, marketing: true, notifications: true },
      });

      const withdrawnState = await manager.withdrawAll('user-1', 'mobile_app');
      expect(withdrawnState.preferences.essential).toBe(true);
      expect(withdrawnState.preferences.analytics).toBe(false);
      expect(withdrawnState.preferences.marketing).toBe(false);
      expect(withdrawnState.preferences.notifications).toBe(false);
      expect(withdrawnState.preferences.data_sharing).toBe(false);

      const metrics = telemetry.getSnapshot();
      expect(metrics.withdrawals['analytics:mobile_app']).toBe(1);
      expect(metrics.withdrawals['marketing:mobile_app']).toBe(1);
      expect(metrics.withdrawals['notifications:mobile_app']).toBe(1);
    });

    it('grantAll sets all optional categories to true', async () => {
      const state = await manager.grantAll('user-1', 'web_portal');
      expect(state.preferences.essential).toBe(true);
      expect(state.preferences.analytics).toBe(true);
      expect(state.preferences.marketing).toBe(true);
      expect(state.preferences.notifications).toBe(true);
      expect(state.preferences.data_sharing).toBe(true);
    });
  });

  describe('Policy Version Invalidation & Re-consent', () => {
    it('identifies users requiring re-consent when policy version increments', async () => {
      await manager.updateConsent({
        userId: 'user-1',
        source: 'mobile_app',
        preferences: { analytics: true },
      });

      expect(await manager.requiresReconsent('user-1')).toBe(false);

      // Create manager with newer policy version
      const upgradedManager = new ConsentManager({
        repository: repo,
        metrics: telemetry,
        policyVersion: '2027-01-01',
      });

      expect(await upgradedManager.requiresReconsent('user-1')).toBe(true);
      const metrics = telemetry.getSnapshot();
      expect(metrics.reconsentRequired).toBe(1);
    });
  });

  describe('Data Portability and Right to Erasure', () => {
    it('exports full consent history under GDPR Art. 15/20', async () => {
      await manager.updateConsent({
        userId: 'user-1',
        source: 'mobile_app',
        preferences: { analytics: true, marketing: true },
      });

      const exportData = await manager.exportConsentHistory('user-1');
      expect(exportData.userId).toBe('user-1');
      expect(exportData.currentState.preferences.analytics).toBe(true);
      expect(exportData.auditTrail).toHaveLength(2);
      expect(exportData.exportedAt).toBeDefined();
    });

    it('forgets user data under GDPR Art. 17', async () => {
      await manager.updateConsent({
        userId: 'user-1',
        source: 'mobile_app',
        preferences: { analytics: true },
      });

      await manager.forgetUser('user-1');
      const state = await repo.getState('user-1');
      const history = await repo.getHistory('user-1');
      expect(state).toBeNull();
      expect(history).toHaveLength(0);
    });
  });
});
