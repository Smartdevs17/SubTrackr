/**
 * Integration tests: API endpoints (monitoring & alerting service layer)
 *
 * Verifies that MonitoringService and AlertingService correctly process
 * transaction events, evaluate alert rules, dispatch alerts, and produce
 * dashboard snapshots — simulating the full API request/response cycle.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MonitoringService } from '../../services/shared/monitoring';
import { AlertingService, createDispatcher } from '../../services/notification/alerting';
import type { TransactionEvent, AlertRule, Alert } from '../../services/shared/types';

// ── Factories ─────────────────────────────────────────────────────────────────
let _txCounter = 0;

function makeTxEvent(overrides: Partial<TransactionEvent> = {}): TransactionEvent {
  return {
    id: `tx-${++_txCounter}`,
    subscriptionId: `sub-${_txCounter}`,
    amount: 9.99,
    currency: 'USD',
    status: 'success',
    timestamp: Date.now(),
    gasUsed: 21000,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: `alert-${++_txCounter}`,
    severity: 'warning',
    title: 'Test Alert',
    message: 'Something happened',
    timestamp: Date.now(),
    resolved: false,
    ruleId: 'test-rule',
    ...overrides,
  };
}

function makeHighFailureRateRule(threshold = 0.3): AlertRule {
  return {
    id: 'high-failure-rate',
    name: 'High failure rate',
    severity: 'critical',
    message: `Failure rate exceeded ${threshold * 100}%`,
    evaluate: (metrics) => {
      // metrics accumulates all historical entries; use the last value for this name
      const latest = [...metrics].reverse().find((x) => x.name === 'failure_rate');
      return latest !== undefined && latest.value > threshold;
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
describe('API endpoints integration', () => {
  let monitoring: MonitoringService;
  let alerting: AlertingService;

  beforeEach(() => {
    _txCounter = 0;
    monitoring = new MonitoringService([]); // no default rules — full control in tests
    alerting = new AlertingService([{ type: 'console' }]);
  });

  // ── MonitoringService ─────────────────────────────────────────────────────

  it('records a transaction and reflects it in the dashboard', () => {
    monitoring.recordTransaction(makeTxEvent({ status: 'success' }));
    const dashboard = monitoring.getDashboard();

    expect(dashboard.totalTransactions).toBe(1);
    expect(dashboard.successRate).toBe(1);
    expect(dashboard.failureCount).toBe(0);
  });

  it('calculates correct success rate with mixed outcomes', () => {
    monitoring.recordTransaction(makeTxEvent({ status: 'success' }));
    monitoring.recordTransaction(makeTxEvent({ status: 'success' }));
    monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));

    const dashboard = monitoring.getDashboard();
    expect(dashboard.totalTransactions).toBe(3);
    expect(dashboard.failureCount).toBe(1);
    expect(dashboard.successRate).toBeCloseTo(2 / 3, 5);
  });

  it('averages gas used across transactions', () => {
    monitoring.recordTransaction(makeTxEvent({ gasUsed: 21000 }));
    monitoring.recordTransaction(makeTxEvent({ gasUsed: 42000 }));

    const dashboard = monitoring.getDashboard();
    expect(dashboard.avgGasUsed).toBe(31500);
  });

  it('getDashboard returns zero/safe values when no data recorded', () => {
    const dashboard = monitoring.getDashboard();
    expect(dashboard.totalTransactions).toBe(0);
    expect(dashboard.successRate).toBe(1); // no failures → 100%
    expect(dashboard.failureCount).toBe(0);
    expect(dashboard.avgGasUsed).toBe(0);
  });

  it('addRule fires an alert when threshold is breached', () => {
    monitoring.addRule(makeHighFailureRateRule(0.1));

    // 2 failures out of 2 = 100% failure rate → exceeds 10% threshold
    monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));
    monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));

    const dashboard = monitoring.getDashboard();
    expect(dashboard.activeAlerts.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.activeAlerts[0].ruleId).toBe('high-failure-rate');
  });

  it('resolveAlert removes alert from active list', () => {
    monitoring.addRule(makeHighFailureRateRule(0.1));
    monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));

    const before = monitoring.getDashboard().activeAlerts;
    expect(before.length).toBeGreaterThanOrEqual(1);

    monitoring.resolveAlert(before[0].id);
    expect(monitoring.getActiveAlerts()).toHaveLength(0);
  });

  it('removeRule stops future alerts for that rule', () => {
    monitoring.addRule(makeHighFailureRateRule(0.1));
    monitoring.removeRule('high-failure-rate');

    monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));
    monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));

    expect(monitoring.getDashboard().activeAlerts).toHaveLength(0);
  });

  it('recentMetrics includes failure_rate after recording transactions', () => {
    monitoring.recordTransaction(makeTxEvent({ status: 'success' }));

    const dashboard = monitoring.getDashboard();
    const metric = dashboard.recentMetrics.find((m) => m.name === 'failure_rate');
    expect(metric).toBeDefined();
    expect(metric!.value).toBe(0);
  });

  // ── AlertingService ───────────────────────────────────────────────────────

  it('dispatch sends alert to console channel without throwing', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const alert = makeAlert({ severity: 'critical', title: 'Critical issue' });

    await alerting.dispatch(alert);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Critical issue'));
    consoleSpy.mockRestore();
  });

  it('dispatch is idempotent — same alert id dispatched only once', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const alert = makeAlert();

    await alerting.dispatch(alert);
    await alerting.dispatch(alert);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('dispatchAll skips resolved alerts', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const active = makeAlert({ resolved: false });
    const resolved = makeAlert({ resolved: true });

    await alerting.dispatchAll([active, resolved]);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('createDispatcher throws when webhookUrl is missing for slack channel', () => {
    expect(() => createDispatcher({ type: 'slack' })).toThrow('webhookUrl required');
  });

  // ── Full pipeline: transactions → metrics → alert → dispatch ─────────────

  it('full pipeline: high failure rate triggers and dispatches a critical alert', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      // Use a low threshold (0.1) so the first failed transaction (50% rate) triggers it
      monitoring.addRule(makeHighFailureRateRule(0.1));

      // 1 success + 1 failure = 50% failure rate → exceeds 10% threshold
      monitoring.recordTransaction(makeTxEvent({ status: 'success' }));
      monitoring.recordTransaction(makeTxEvent({ status: 'failed' }));

      const { activeAlerts } = monitoring.getDashboard();
      expect(activeAlerts.length).toBeGreaterThanOrEqual(1);
      expect(activeAlerts[0].severity).toBe('critical');

      // Use a fresh alerting instance to avoid any cross-test state
      const freshAlerting = new AlertingService([{ type: 'console' }]);
      await freshAlerting.dispatchAll(activeAlerts);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL'));
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
