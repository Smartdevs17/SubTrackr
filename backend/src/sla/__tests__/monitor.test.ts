import { createSlaMonitor, type SlaMonitorOptions } from '../monitor';
import { SlaError } from '../errors';
import { CreditService } from '../../../services/billing/creditService';
import type { Alert } from '../../../services/shared/types';
import type { SlaMetrics } from '../types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const JUNE = Date.UTC(2026, 5, 1);
const JULY = Date.UTC(2026, 6, 1);
const AUGUST = Date.UTC(2026, 7, 1);

function harness(overrides: Partial<SlaMonitorOptions> = {}) {
  let clock = JUNE;
  const alerts: Alert[] = [];
  const credits = new CreditService({ clock: () => Math.floor(clock / 1000) });
  const metrics: SlaMetrics = { increment: jest.fn(), gauge: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const monitor = createSlaMonitor({
    creditIssuer: credits,
    alerts: { dispatch: (a) => void alerts.push(a) },
    metrics,
    logger,
    now: () => clock,
    ...overrides,
  });
  monitor.register({
    subscriptionId: 'sub_ent',
    accountId: 'acct_ent',
    tier: 'enterprise',
    periodFee: 500,
  });
  monitor.register({
    subscriptionId: 'sub_basic',
    accountId: 'acct_basic',
    tier: 'basic',
    periodFee: 20,
  });
  return {
    monitor,
    alerts,
    credits,
    metrics,
    logger,
    setTime: (t: number) => {
      clock = t;
    },
  };
}

describe('registration', () => {
  it('rejects duplicates, unknown tiers, missing accounts and bad fees', () => {
    const { monitor } = harness();
    const base = { subscriptionId: 'sub_x', accountId: 'acct_x', tier: 'premium', periodFee: 10 };
    expect(() => monitor.register({ ...base, subscriptionId: 'sub_ent' })).toThrow(SlaError);
    expect(() => monitor.register({ ...base, tier: 'platinum' })).toThrow(/not configured/);
    expect(() => monitor.register({ ...base, accountId: '' })).toThrow(/accountId/);
    expect(() => monitor.register({ ...base, periodFee: -1 })).toThrow(/periodFee/);
    expect(monitor.register(base).registeredAt).toBe(JUNE);
  });

  it('rejects activity for unknown subscriptions', () => {
    const { monitor } = harness();
    expect(() => monitor.recordRequest('nope', { latencyMs: 10, ok: true })).toThrow(
      expect.objectContaining({ code: 'unknown_subscription' })
    );
    expect(() => monitor.getStatus('nope')).toThrow(SlaError);
  });

  it('stops monitoring after unregister', () => {
    const { monitor } = harness();
    monitor.unregister('sub_basic');
    expect(monitor.getSubscription('sub_basic')).toBeUndefined();
    expect(() => monitor.unregister('sub_basic')).toThrow(SlaError);
  });
});

describe('incidents', () => {
  it('validates incident ranges and scope', () => {
    const { monitor } = harness();
    expect(() => monitor.openIncident({ start: JUNE + HOUR, end: JUNE })).toThrow(
      /after its start/
    );
    expect(() => monitor.openIncident({ subscriptionIds: ['ghost'] })).toThrow(SlaError);
    const incident = monitor.openIncident({ id: 'inc-1' });
    expect(() => monitor.openIncident({ id: 'inc-1' })).toThrow(/already exists/);
    expect(() => monitor.resolveIncident('missing')).toThrow(
      expect.objectContaining({ code: 'unknown_incident' })
    );
    expect(() => monitor.resolveIncident(incident.id, JUNE)).toThrow(/after its start/);
    monitor.resolveIncident(incident.id, JUNE + MIN);
    expect(() => monitor.resolveIncident(incident.id)).toThrow(/already resolved/);
  });

  it('counts an open incident as downtime until now', () => {
    const { monitor, setTime } = harness();
    monitor.openIncident({ start: JUNE });
    setTime(JUNE + 10 * MIN);
    expect(monitor.getStatus('sub_ent').downtimeMs).toBe(10 * MIN);
  });

  it('scopes incidents to the listed subscriptions', () => {
    const { monitor, setTime } = harness();
    monitor.openIncident({ start: JUNE, end: JUNE + HOUR, subscriptionIds: ['sub_basic'] });
    setTime(JUNE + 2 * HOUR);
    expect(monitor.getStatus('sub_basic').downtimeMs).toBe(HOUR);
    expect(monitor.getStatus('sub_ent').downtimeMs).toBe(0);
  });

  it('excludes scheduled maintenance', () => {
    const { monitor, setTime } = harness();
    monitor.scheduleMaintenance(JUNE, JUNE + 2 * HOUR, undefined, 'DB upgrade');
    monitor.openIncident({ start: JUNE + HOUR, end: JUNE + 90 * MIN });
    setTime(JUNE + 3 * HOUR);
    expect(monitor.getStatus('sub_ent').downtimeMs).toBe(0);
    expect(monitor.listIncidents()).toHaveLength(2);
  });
});

describe('live alerting', () => {
  it('warns when the downtime budget is at risk, then alerts on breach once', async () => {
    const { monitor, alerts, setTime } = harness();
    // Enterprise budget: 43.2 min. At-risk threshold: 50%.
    monitor.openIncident({ start: JUNE, end: JUNE + 25 * MIN, subscriptionIds: ['sub_ent'] });
    setTime(JUNE + HOUR);
    await monitor.check();
    expect(alerts.map((a) => a.ruleId)).toEqual(['sla-at-risk-uptime']);
    expect(alerts[0].severity).toBe('warning');

    monitor.openIncident({
      start: JUNE + 2 * HOUR,
      end: JUNE + 2 * HOUR + 20 * MIN,
      subscriptionIds: ['sub_ent'],
    });
    setTime(JUNE + 3 * HOUR);
    await monitor.check();
    await monitor.check();
    const breach = alerts.filter((a) => a.ruleId === 'sla-breach-uptime');
    expect(breach).toHaveLength(1);
    expect(breach[0].severity).toBe('critical');
    expect(breach[0].id).toBe(`sla:sub_ent:${JUNE}:breach:uptime`);
  });

  it('uses each tier’s breach severity', async () => {
    const { monitor, alerts, setTime } = harness();
    // 8 hours down breaches both tiers' budgets (basic allows 7.2 h).
    monitor.openIncident({ start: JUNE, end: JUNE + 8 * HOUR });
    setTime(JUNE + 9 * HOUR);
    await monitor.check();
    const bySub = Object.fromEntries(
      alerts
        .filter((a) => a.ruleId === 'sla-breach-uptime')
        .map((a) => [a.id.split(':')[1], a.severity])
    );
    expect(bySub).toEqual({ sub_ent: 'critical', sub_basic: 'info' });
  });

  it('alerts on latency and error-rate breaches', async () => {
    const { monitor, alerts, setTime } = harness();
    for (let i = 0; i < 100; i++) {
      monitor.recordRequest('sub_ent', { latencyMs: i < 90 ? 200 : 5_000, ok: i < 98 });
    }
    setTime(JUNE + HOUR);
    await monitor.check();
    expect(alerts.map((a) => a.ruleId).sort()).toEqual([
      'sla-breach-error_rate',
      'sla-breach-latency',
    ]);
  });

  it('publishes gauges for every subscription', async () => {
    const { monitor, metrics, setTime } = harness();
    setTime(JUNE + HOUR);
    const reports = await monitor.check();
    expect(reports).toHaveLength(2);
    expect(metrics.gauge).toHaveBeenCalledWith('sla_uptime_percent', 100, {
      subscription_id: 'sub_ent',
      tier: 'enterprise',
    });
  });

  it('retries an alert whose dispatch failed', async () => {
    const dispatch = jest
      .fn()
      .mockRejectedValueOnce(new Error('slack down'))
      .mockResolvedValue(undefined);
    const { monitor, logger, setTime } = harness({ alerts: { dispatch } });
    monitor.openIncident({ start: JUNE, end: JUNE + HOUR, subscriptionIds: ['sub_ent'] });
    setTime(JUNE + 2 * HOUR);
    await monitor.check();
    expect(logger.error).toHaveBeenCalledWith('SLA alert dispatch failed', expect.any(Object));
    await monitor.check();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('credit issuance', () => {
  it('refuses to close a period that is still running', async () => {
    const { monitor, setTime } = harness();
    setTime(JULY - 1);
    await expect(monitor.closePeriod('sub_ent', JUNE)).rejects.toMatchObject({
      code: 'period_open',
    });
    await expect(monitor.closePeriod('sub_ent', JUNE + 1)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('issues the tier credit to the ledger exactly once', async () => {
    const { monitor, credits, setTime } = harness();
    // 2 hours down in June: 99.72% uptime → enterprise step "<99.9" = 10% of 500.
    monitor.openIncident({ start: JUNE + HOUR, end: JUNE + 3 * HOUR });
    setTime(JULY + HOUR);

    const record = await monitor.closePeriod('sub_ent', JUNE);
    expect(record).toMatchObject({ status: 'issued', creditPercent: 10, amount: 50, attempts: 1 });
    expect(credits.getBalance('acct_ent')).toBe(50);

    const again = await monitor.closePeriod('sub_ent', JUNE);
    expect(again).toBe(record);
    expect(credits.getBalance('acct_ent')).toBe(50);
    expect(credits.getAccount('acct_ent').entries[0]).toMatchObject({
      kind: 'issue',
      counterparty: 'system:sla',
    });
  });

  it('records compliant periods as not owed', async () => {
    const { monitor, credits, setTime } = harness();
    setTime(JULY);
    const record = await monitor.closePeriod('sub_ent', JUNE);
    expect(record.status).toBe('not_owed');
    expect(record.amount).toBe(0);
    expect(credits.getBalance('acct_ent')).toBe(0);
  });

  it('retries a failed issuance with the same amount and alerts', async () => {
    const issueCredit = jest.fn().mockImplementationOnce(() => {
      throw new Error('ledger unavailable');
    });
    const { monitor, alerts, metrics, setTime } = harness({ creditIssuer: { issueCredit } });
    monitor.openIncident({ start: JUNE + HOUR, end: JUNE + 3 * HOUR });
    setTime(JULY);

    const failed = await monitor.closePeriod('sub_ent', JUNE);
    expect(failed).toMatchObject({ status: 'failed', error: 'ledger unavailable', amount: 50 });
    expect(alerts.some((a) => a.ruleId === 'sla-credit-failed')).toBe(true);
    expect(metrics.increment).toHaveBeenCalledWith('sla_credit_failures_total', {
      tier: 'enterprise',
    });

    // A late outage record must not change an already-evaluated period.
    monitor.openIncident({ start: JUNE + 10 * HOUR, end: JUNE + 30 * HOUR });
    const retried = await monitor.closePeriod('sub_ent', JUNE);
    expect(retried).toMatchObject({ status: 'issued', amount: 50, attempts: 2 });
    expect(issueCredit).toHaveBeenCalledTimes(2);
  });

  it('closes every finished period, skipping settled ones', async () => {
    const { monitor, credits, setTime } = harness();
    monitor.openIncident({ start: JUNE, end: JUNE + 8 * HOUR });
    setTime(AUGUST + HOUR);

    const first = await monitor.closeCompletedPeriods();
    // Two subscriptions × June and July.
    expect(first).toHaveLength(4);
    // basic: 8h of a 30-day month = 98.89% → "<99" step = 5% of 20.
    expect(credits.getBalance('acct_basic')).toBe(1);
    // enterprise: 98.89% → "<99" step = 25% of 500.
    expect(credits.getBalance('acct_ent')).toBe(125);
    expect(monitor.getCredits('sub_ent').map((c) => c.status)).toEqual(['issued', 'not_owed']);

    expect(await monitor.closeCompletedPeriods()).toHaveLength(0);
  });

  it('starts settling from the enrolment month', async () => {
    const { monitor, setTime } = harness();
    monitor.register({
      subscriptionId: 'sub_late',
      accountId: 'acct_late',
      tier: 'premium',
      periodFee: 50,
      registeredAt: JULY + 5 * HOUR,
    });
    setTime(AUGUST);
    const settled = await monitor.closeCompletedPeriods();
    expect(
      settled.filter((c) => c.subscriptionId === 'sub_late').map((c) => c.periodStart)
    ).toEqual([JULY]);
  });
});
