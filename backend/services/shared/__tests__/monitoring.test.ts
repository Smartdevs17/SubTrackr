import { MonitoringService } from '../monitoring';
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
});
