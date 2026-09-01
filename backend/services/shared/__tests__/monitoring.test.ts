import { MonitoringService, calculateSlaCreditAmount } from '../monitoring';
import type { TransactionEvent } from '../types';

const makeEvent = (
  status: TransactionEvent['status'],
  gasUsed?: number,
  id = Math.random().toString(36)
): TransactionEvent => ({
  id,
  subscriptionId: 'sub-1',
  amount: 10,
  currency: 'USD',
  status,
  timestamp: Date.now(),
  gasUsed,
});

const makeSlaEvent = (
  subscriptionId: string,
  status: TransactionEvent['status'],
  timestamp: number = Date.now(),
  id = Math.random().toString(36)
): TransactionEvent => ({
  id,
  subscriptionId,
  amount: 10,
  currency: 'USD',
  status,
  timestamp,
  gasUsed: 100_000,
});

describe('MonitoringService', () => {
  let svc: MonitoringService;
  beforeEach(() => {
    svc = new MonitoringService();
  });

  // ── Transaction recording ─────────────────────────────────────────────────

  it('records transactions and reflects them in dashboard', () => {
    svc.recordTransaction(makeEvent('success'));
    svc.recordTransaction(makeEvent('success'));
    const dash = svc.getDashboard();
    expect(dash.totalTransactions).toBe(2);
    expect(dash.failureCount).toBe(0);
    expect(dash.successRate).toBe(1);
  });

  it('tracks failed transactions', () => {
    svc.recordTransaction(makeEvent('success'));
    svc.recordTransaction(makeEvent('failed'));
    const dash = svc.getDashboard();
    expect(dash.failureCount).toBe(1);
    expect(dash.successRate).toBe(0.5);
  });

  it('computes average gas used', () => {
    svc.recordTransaction(makeEvent('success', 100_000));
    svc.recordTransaction(makeEvent('success', 300_000));
    expect(svc.getDashboard().avgGasUsed).toBe(200_000);
  });

  // ── Anomaly detection ─────────────────────────────────────────────────────

  it('raises critical alert when failure rate exceeds 30 %', () => {
    // 4 failures out of 5 = 80 %
    for (let i = 0; i < 4; i++) svc.recordTransaction(makeEvent('failed'));
    svc.recordTransaction(makeEvent('success'));
    const alerts = svc.getActiveAlerts();
    expect(alerts.some((a) => a.ruleId === 'high-failure-rate')).toBe(true);
    expect(alerts.find((a) => a.ruleId === 'high-failure-rate')?.severity).toBe('critical');
  });

  it('raises warning alert when avg gas exceeds 500 000', () => {
    svc.recordTransaction(makeEvent('success', 600_000));
    expect(svc.getActiveAlerts().some((a) => a.ruleId === 'gas-spike')).toBe(true);
  });

  it('does not raise duplicate alerts for the same open rule', () => {
    for (let i = 0; i < 6; i++) svc.recordTransaction(makeEvent('failed'));
    const alerts = svc.getActiveAlerts().filter((a) => a.ruleId === 'high-failure-rate');
    expect(alerts).toHaveLength(1);
  });

  it('does not alert when failure rate is below threshold', () => {
    svc.recordTransaction(makeEvent('success'));
    svc.recordTransaction(makeEvent('success'));
    expect(svc.getActiveAlerts().some((a) => a.ruleId === 'high-failure-rate')).toBe(false);
  });

  // ── Alert resolution ──────────────────────────────────────────────────────

  it('resolves an alert by id', () => {
    for (let i = 0; i < 4; i++) svc.recordTransaction(makeEvent('failed'));
    svc.recordTransaction(makeEvent('success'));
    const alert = svc.getActiveAlerts().find((a) => a.ruleId === 'high-failure-rate')!;
    svc.resolveAlert(alert.id);
    expect(svc.getActiveAlerts().some((a) => a.id === alert.id)).toBe(false);
  });

  // ── Custom rules ──────────────────────────────────────────────────────────

  it('supports adding a custom alert rule', () => {
    svc.addRule({
      id: 'custom-rule',
      name: 'Custom Rule',
      severity: 'info',
      message: 'Custom triggered',
      evaluate: () => true,
    });
    svc.recordTransaction(makeEvent('success'));
    expect(svc.getActiveAlerts().some((a) => a.ruleId === 'custom-rule')).toBe(true);
  });

  it('supports removing a rule', () => {
    svc.removeRule('gas-spike');
    svc.recordTransaction(makeEvent('success', 999_999));
    expect(svc.getActiveAlerts().some((a) => a.ruleId === 'gas-spike')).toBe(false);
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────

  it('dashboard returns empty state when no events recorded', () => {
    const dash = svc.getDashboard();
    expect(dash.totalTransactions).toBe(0);
    expect(dash.successRate).toBe(1);
    expect(dash.activeAlerts).toHaveLength(0);
  });

  // ── SLA target configuration ──────────────────────────────────────────────

  describe('SLA monitoring — target configuration', () => {
    it('registers an SLA target and reports a compliant initial status', () => {
      svc.setSlaTarget('sub-sla', { uptimeTarget: 99, measurementInterval: 86_400 });
      const status = svc.getSlaStatus('sub-sla');
      expect(status).not.toBeNull();
      expect(status!.uptimeTarget).toBe(99);
      expect(status!.uptimePercentage).toBe(100);
      expect(status!.compliant).toBe(true);
      expect(status!.observedTransactions).toBe(0);
      expect(svc.getSlaBreaches('sub-sla')).toHaveLength(0);
    });

    it('normalizes invalid target values', () => {
      svc.setSlaTarget('sub-bad', {
        uptimeTarget: Number.NaN,
        measurementInterval: -50,
        creditCap: -3,
      });
      const target = svc.getSlaTarget('sub-bad');
      expect(target).toEqual({
        uptimeTarget: 99,
        measurementInterval: 1,
        creditCap: 0,
      });
    });

    it('clamps uptime target into 0–100', () => {
      svc.setSlaTarget('sub-clamp', { uptimeTarget: 150, measurementInterval: 60 });
      expect(svc.getSlaTarget('sub-clamp')!.uptimeTarget).toBe(100);
    });

    it('updates an existing target in place', () => {
      svc.setSlaTarget('sub-upd', { uptimeTarget: 99, measurementInterval: 60 });
      svc.setSlaTarget('sub-upd', { uptimeTarget: 99.9, measurementInterval: 120 });
      expect(svc.getSlaTarget('sub-upd')).toEqual({
        uptimeTarget: 99.9,
        measurementInterval: 120,
        creditCap: 0,
      });
    });

    it('returns null status and no breaches after removeSlaTarget', () => {
      svc.setSlaTarget('sub-rm', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-rm', 'failed'));
      expect(svc.getSlaBreaches('sub-rm')).toHaveLength(1);

      svc.removeSlaTarget('sub-rm');
      expect(svc.getSlaStatus('sub-rm')).toBeNull();
      expect(svc.getSlaTarget('sub-rm')).toBeUndefined();
      // Breach history is retained; no open alert remains for the subscription.
      expect(svc.getSlaBreaches('sub-rm')).toHaveLength(1);
      expect(svc.getActiveAlerts().some((a) => a.ruleId === 'sla-breach:sub-rm')).toBe(false);
    });
  });

  // ── SLA breach detection ──────────────────────────────────────────────────

  describe('SLA monitoring — breach detection', () => {
    it('detects a breach when uptime drops below target and issues credit', () => {
      svc.setSlaTarget('sub-breach', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-breach', 'success'));
      svc.recordTransaction(makeSlaEvent('sub-breach', 'failed'));

      const breaches = svc.getSlaBreaches('sub-breach');
      expect(breaches).toHaveLength(1);
      expect(breaches[0].resolvedAt).toBeNull();
      expect(breaches[0].uptimePercentage).toBe(50);
      expect(breaches[0].observedTransactions).toBe(2);
      expect(breaches[0].failedTransactions).toBe(1);
      expect(breaches[0].creditAmount).toBeGreaterThan(0);

      const status = svc.getSlaStatus('sub-breach');
      expect(status!.compliant).toBe(false);
      expect(status!.activeBreachId).toBe(breaches[0].id);
      expect(status!.creditBalance).toBe(breaches[0].creditAmount);
    });

    it('raises an SLA alert alongside the breach', () => {
      svc.setSlaTarget('sub-alert', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-alert', 'failed'));

      const alert = svc.getActiveAlerts().find((a) => a.ruleId === 'sla-breach:sub-alert');
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('critical'); // deviation 99% ≥ 5
      expect(alert!.correlationId).toBe(svc.getSlaBreaches('sub-alert')[0].id);
    });

    it('does not open a breach while uptime stays at or above the target', () => {
      svc.setSlaTarget('sub-ok', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-ok', 'success'));
      svc.recordTransaction(makeSlaEvent('sub-ok', 'success'));
      svc.recordTransaction(makeSlaEvent('sub-ok', 'failed')); // 66.67% → breach

      expect(svc.getSlaBreaches('sub-ok')).toHaveLength(1);

      // A second failure keeps the same single open breach (no duplicates).
      svc.recordTransaction(makeSlaEvent('sub-ok', 'failed'));
      expect(svc.getSlaBreaches('sub-ok')).toHaveLength(1);
      expect(svc.getSlaBreaches('sub-ok')[0].resolvedAt).toBeNull();
    });

    it('ignores pending transactions when computing uptime', () => {
      svc.setSlaTarget('sub-pending', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-pending', 'pending'));
      svc.recordTransaction(makeSlaEvent('sub-pending', 'failed'));
      svc.recordTransaction(makeSlaEvent('sub-pending', 'success'));

      const status = svc.getSlaStatus('sub-pending');
      expect(status!.observedTransactions).toBe(2);
      expect(status!.uptimePercentage).toBe(50);
      expect(svc.getSlaBreaches('sub-pending')).toHaveLength(1);
    });

    it('ignores transactions outside the measurement window', () => {
      const interval = 3_600;
      svc.setSlaTarget('sub-window', { uptimeTarget: 99, measurementInterval: interval });
      const stale = Date.now() - (interval * 1000 + 5_000);
      svc.recordTransaction(makeSlaEvent('sub-window', 'failed', stale));

      const status = svc.getSlaStatus('sub-window');
      expect(status!.observedTransactions).toBe(0);
      expect(status!.compliant).toBe(true);
      expect(svc.getSlaBreaches('sub-window')).toHaveLength(0);
    });

    it('auto-resolves the breach and its alert when uptime recovers', () => {
      svc.setSlaTarget('sub-recover', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-recover', 'failed'));
      svc.recordTransaction(makeSlaEvent('sub-recover', 'success')); // 50% → breach

      expect(svc.getSlaBreaches('sub-recover')).toHaveLength(1);
      expect(svc.getActiveAlerts().some((a) => a.ruleId === 'sla-breach:sub-recover')).toBe(true);

      // 99 successes + 1 failure = 99% uptime → back at target.
      for (let i = 0; i < 98; i++) {
        svc.recordTransaction(makeSlaEvent('sub-recover', 'success'));
      }

      const status = svc.getSlaStatus('sub-recover');
      expect(status!.compliant).toBe(true);
      expect(svc.getSlaBreaches('sub-recover')[0].resolvedAt).not.toBeNull();
      expect(status!.activeBreachId).toBeNull();
      expect(svc.getActiveAlerts().some((a) => a.ruleId === 'sla-breach:sub-recover')).toBe(false);
    });

    it('tracks a full breach lifecycle: detect → resolve → detect again', () => {
      svc.setSlaTarget('sub-lifecycle', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-lifecycle', 'failed'));
      svc.recordTransaction(makeSlaEvent('sub-lifecycle', 'success')); // breach #1

      for (let i = 0; i < 98; i++) {
        svc.recordTransaction(makeSlaEvent('sub-lifecycle', 'success'));
      } // 99% → resolved

      svc.recordTransaction(makeSlaEvent('sub-lifecycle', 'failed')); // 98.02% → breach #2
      svc.recordTransaction(makeSlaEvent('sub-lifecycle', 'failed'));

      const breaches = svc.getSlaBreaches('sub-lifecycle');
      expect(breaches).toHaveLength(2);
      // Newest breach first, and it is the open one.
      expect(breaches[0].resolvedAt).toBeNull();
      expect(breaches[1].resolvedAt).not.toBeNull();
      expect(svc.getSlaStatus('sub-lifecycle')!.breachCount).toBe(2);
    });

    it('monitors multiple subscriptions independently', () => {
      svc.setSlaTarget('sub-a', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.setSlaTarget('sub-b', { uptimeTarget: 99, measurementInterval: 86_400 });

      svc.recordTransaction(makeSlaEvent('sub-a', 'failed'));
      svc.recordTransaction(makeSlaEvent('sub-a', 'success'));
      svc.recordTransaction(makeSlaEvent('sub-b', 'success'));

      expect(svc.getSlaBreaches('sub-a')).toHaveLength(1);
      expect(svc.getSlaBreaches('sub-b')).toHaveLength(0);
      expect(svc.getSlaStatus('sub-b')!.compliant).toBe(true);
    });
  });

  // ── SLA breach management ─────────────────────────────────────────────────

  describe('SLA monitoring — breach management', () => {
    it('manually resolves a breach and its alert', () => {
      svc.setSlaTarget('sub-manual', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-manual', 'failed'));
      const breach = svc.getSlaBreaches('sub-manual')[0];

      svc.resolveSlaBreach(breach.id);
      expect(svc.getSlaBreaches('sub-manual')[0].resolvedAt).not.toBeNull();
      expect(svc.getActiveAlerts().some((a) => a.ruleId === 'sla-breach:sub-manual')).toBe(false);
      expect(svc.getSlaStatus('sub-manual')!.activeBreachId).toBeNull();
    });

    it('acknowledges a breach', () => {
      svc.setSlaTarget('sub-ack', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-ack', 'failed'));
      const breach = svc.getSlaBreaches('sub-ack')[0];

      svc.acknowledgeSlaBreach(breach.id);
      expect(svc.getSlaBreaches('sub-ack')[0].acknowledged).toBe(true);
    });

    it('is a no-op for unknown breach ids', () => {
      expect(() => svc.resolveSlaBreach('nope')).not.toThrow();
      expect(() => svc.acknowledgeSlaBreach('nope')).not.toThrow();
    });
  });

  // ── SLA credit calculation ────────────────────────────────────────────────

  describe('calculateSlaCreditAmount', () => {
    const target = { uptimeTarget: 99, measurementInterval: 86_400, creditCap: 0 };

    it('returns 0 when uptime is at or above target', () => {
      expect(calculateSlaCreditAmount(target, 99)).toBe(0);
      expect(calculateSlaCreditAmount(target, 99.5)).toBe(0);
    });

    it('returns at least 1 for any breach', () => {
      expect(calculateSlaCreditAmount(target, 98.9999)).toBeGreaterThanOrEqual(1);
    });

    it('scales credit with the size of the deficit', () => {
      const small = calculateSlaCreditAmount(target, 98);
      const large = calculateSlaCreditAmount(target, 50);
      expect(large).toBeGreaterThan(small);
    });

    it('respects the credit cap when set', () => {
      const capped = calculateSlaCreditAmount({ ...target, creditCap: 250 }, 50);
      expect(capped).toBe(250);
    });

    it('is unaffected by an explicit zero cap', () => {
      const uncapped = calculateSlaCreditAmount({ ...target, creditCap: 0 }, 50);
      expect(uncapped).toBe(calculateSlaCreditAmount(target, 50));
    });
  });

  // ── SLA summary & dashboard integration ───────────────────────────────────

  describe('SLA monitoring — summary and dashboard', () => {
    it('exposes SLA data through getDashboard', () => {
      svc.setSlaTarget('sub-dash', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-dash', 'failed'));
      svc.recordTransaction(makeSlaEvent('sub-dash', 'success'));

      const dash = svc.getDashboard();
      expect(dash.slaStatuses).toHaveLength(1);
      expect(dash.slaStatuses[0].subscriptionId).toBe('sub-dash');
      expect(dash.slaBreaches).toHaveLength(1);
      expect(dash.slaSummary.totalMonitored).toBe(1);
      expect(dash.slaSummary.breached).toBe(1);
      expect(dash.slaSummary.openBreaches).toBe(1);
      expect(dash.slaSummary.totalCreditsIssued).toBeGreaterThan(0);
    });

    it('aggregates summary across healthy and breached subscriptions', () => {
      svc.setSlaTarget('sub-healthy', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.setSlaTarget('sub-broken', { uptimeTarget: 99, measurementInterval: 86_400 });
      svc.recordTransaction(makeSlaEvent('sub-healthy', 'success'));
      svc.recordTransaction(makeSlaEvent('sub-broken', 'failed'));

      const summary = svc.getSlaSummary();
      expect(summary.totalMonitored).toBe(2);
      expect(summary.compliant).toBe(1);
      expect(summary.breached).toBe(1);
      expect(summary.openBreaches).toBe(1);
    });

    it('returns an empty summary when nothing is monitored', () => {
      expect(svc.getSlaSummary()).toEqual({
        totalMonitored: 0,
        compliant: 0,
        breached: 0,
        openBreaches: 0,
        totalCreditsIssued: 0,
      });
    });
  });
});
