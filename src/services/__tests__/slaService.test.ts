/**
 * Unit tests for slaService.ts — Issue #383
 *
 * Covers:
 *  - SLA metric tracking (uptime, response time, throughput)
 *  - Breach detection with automatic credit calculation
 *  - SLA exclusion periods (maintenance windows)
 *  - Credit calculation accuracy
 *  - Report generation for enterprise customers
 */

import {
  normalizeSlaConfig,
  calculateAvailabilityImpact,
  calculateUptimePercentage,
  calculateCreditAmount,
  calculateMerchantStatus,
  evaluateMerchantSnapshot,
  buildSlaDashboardReport,
  SLA_DEFAULTS,
} from '../slaService';
import type { SlaAvailabilityEvent, SlaBreach, SlaConfig, SlaStatus } from '../../types/sla';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
const nextId = () => `test-${++idCounter}`;

const makeConfig = (overrides: Partial<SlaConfig> = {}): SlaConfig => ({
  merchantId: 'merchant-test',
  uptimeTarget: 99,
  measurementInterval: 86_400, // 1 day in seconds
  subscriberContacts: [],
  ...overrides,
});

const makeEvent = (
  overrides: Partial<SlaAvailabilityEvent> & { merchantId?: string } = {}
): SlaAvailabilityEvent => ({
  id: nextId(),
  merchantId: 'merchant-test',
  timestamp: Date.now() - 3_600_000, // 1 hour ago
  durationSeconds: 3_600,
  state: 'healthy',
  ...overrides,
});

const makeBreach = (overrides: Partial<SlaBreach> = {}): SlaBreach => ({
  id: nextId(),
  merchantId: 'merchant-test',
  detectedAt: Date.now() - 7_200_000,
  uptimeTarget: 99,
  uptimePercentage: 95,
  measurementInterval: 86_400,
  observedSeconds: 86_400,
  downtimeSeconds: 4_320,
  partialOutageSeconds: 0,
  maintenanceSeconds: 0,
  creditAmount: 500,
  resolvedAt: null,
  acknowledged: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// normalizeSlaConfig
// ---------------------------------------------------------------------------

describe('normalizeSlaConfig', () => {
  it('uses provided values when valid', () => {
    const config = normalizeSlaConfig('m1', { uptimeTarget: 99.5, measurementInterval: 3_600 });
    expect(config.merchantId).toBe('m1');
    expect(config.uptimeTarget).toBe(99.5);
    expect(config.measurementInterval).toBe(3_600);
  });

  it('falls back to defaults when values are missing', () => {
    const config = normalizeSlaConfig('m2', {});
    expect(config.uptimeTarget).toBe(SLA_DEFAULTS.uptimeTarget);
    expect(config.measurementInterval).toBe(SLA_DEFAULTS.measurementInterval);
  });

  it('falls back to defaults when values are non-finite', () => {
    const config = normalizeSlaConfig('m3', { uptimeTarget: NaN, measurementInterval: Infinity });
    expect(config.uptimeTarget).toBe(SLA_DEFAULTS.uptimeTarget);
    expect(config.measurementInterval).toBe(SLA_DEFAULTS.measurementInterval);
  });

  it('clamps measurementInterval to at least 1 second', () => {
    const config = normalizeSlaConfig('m4', { measurementInterval: 0 });
    expect(config.measurementInterval).toBeGreaterThanOrEqual(1);
  });

  it('copies subscriberContacts array', () => {
    const contacts = ['a@example.com', 'b@example.com'];
    const config = normalizeSlaConfig('m5', { subscriberContacts: contacts });
    expect(config.subscriberContacts).toEqual(contacts);
    // Ensure it's a copy, not the same reference
    expect(config.subscriberContacts).not.toBe(contacts);
  });

  it('defaults subscriberContacts to empty array when not provided', () => {
    const config = normalizeSlaConfig('m6', {});
    expect(config.subscriberContacts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calculateAvailabilityImpact
// ---------------------------------------------------------------------------

describe('calculateAvailabilityImpact', () => {
  it('healthy state has zero impact', () => {
    const impact = calculateAvailabilityImpact(
      makeEvent({ state: 'healthy', durationSeconds: 3_600 })
    );
    expect(impact.downtimeSeconds).toBe(0);
    expect(impact.partialOutageSeconds).toBe(0);
    expect(impact.maintenanceSeconds).toBe(0);
  });

  it('full_outage counts 100% of duration as downtime', () => {
    const impact = calculateAvailabilityImpact(
      makeEvent({ state: 'full_outage', durationSeconds: 3_600 })
    );
    expect(impact.downtimeSeconds).toBe(3_600 * 1); // weight = 1
    expect(impact.partialOutageSeconds).toBe(0);
    expect(impact.maintenanceSeconds).toBe(0);
  });

  it('partial_outage counts 50% of duration as downtime', () => {
    const impact = calculateAvailabilityImpact(
      makeEvent({ state: 'partial_outage', durationSeconds: 3_600 })
    );
    expect(impact.downtimeSeconds).toBe(3_600 * 0.5); // weight = 0.5
    expect(impact.partialOutageSeconds).toBe(3_600);
    expect(impact.maintenanceSeconds).toBe(0);
  });

  it('maintenance window has zero downtime impact (SLA exclusion)', () => {
    const impact = calculateAvailabilityImpact(
      makeEvent({ state: 'maintenance', durationSeconds: 7_200 })
    );
    expect(impact.downtimeSeconds).toBe(0);
    expect(impact.partialOutageSeconds).toBe(0);
    expect(impact.maintenanceSeconds).toBe(7_200);
  });
});

// ---------------------------------------------------------------------------
// calculateUptimePercentage
// ---------------------------------------------------------------------------

describe('calculateUptimePercentage', () => {
  it('returns 100 when no observed seconds', () => {
    expect(calculateUptimePercentage(0, 0)).toBe(100);
  });

  it('returns 100 when no downtime', () => {
    expect(calculateUptimePercentage(86_400, 0)).toBe(100);
  });

  it('returns 0 when all time is downtime', () => {
    expect(calculateUptimePercentage(3_600, 3_600)).toBe(0);
  });

  it('calculates correct percentage for partial downtime', () => {
    // 1 hour downtime in 24 hours = 95.83% uptime
    const result = calculateUptimePercentage(86_400, 3_600);
    expect(result).toBeCloseTo(95.83, 1);
  });

  it('clamps result to [0, 100]', () => {
    // Pathological: more downtime than observed
    const result = calculateUptimePercentage(100, 200);
    expect(result).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    const result = calculateUptimePercentage(86_400, 3_600);
    const decimals = result.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// calculateCreditAmount
// ---------------------------------------------------------------------------

describe('calculateCreditAmount', () => {
  it('returns 0 when uptime meets the target', () => {
    const credit = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 99.5,
      measurementInterval: 86_400,
    });
    expect(credit).toBe(0);
  });

  it('returns a positive integer when uptime is below target', () => {
    const credit = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 95,
      measurementInterval: 86_400,
    });
    expect(credit).toBeGreaterThan(0);
    expect(Number.isInteger(credit)).toBe(true);
  });

  it('returns at least 1 credit for any breach', () => {
    const credit = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 98.99,
      measurementInterval: 86_400,
    });
    expect(credit).toBeGreaterThanOrEqual(1);
  });

  it('issues more credit for a larger deficit', () => {
    const smallDeficit = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 98,
      measurementInterval: 86_400,
    });
    const largeDeficit = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 90,
      measurementInterval: 86_400,
    });
    expect(largeDeficit).toBeGreaterThan(smallDeficit);
  });

  it('issues more credit for a longer measurement interval', () => {
    const shortWindow = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 95,
      measurementInterval: 3_600,
    });
    const longWindow = calculateCreditAmount({
      uptimeTarget: 99,
      uptimePercentage: 95,
      measurementInterval: 604_800,
    });
    expect(longWindow).toBeGreaterThan(shortWindow);
  });
});

// ---------------------------------------------------------------------------
// calculateMerchantStatus
// ---------------------------------------------------------------------------

describe('calculateMerchantStatus', () => {
  const now = 1_700_000_000_000; // fixed timestamp in ms

  it('returns compliant status with 100% uptime when no events exist', () => {
    const config = makeConfig({ merchantId: 'clean-merchant' });
    const status = calculateMerchantStatus(config, [], [], now);

    expect(status.compliant).toBe(true);
    expect(status.uptimePercentage).toBe(100);
    expect(status.observedSeconds).toBe(0);
  });

  it('detects a breach when full_outage exceeds the SLA threshold', () => {
    const config = makeConfig({
      merchantId: 'breach-merchant',
      uptimeTarget: 99.9,
      measurementInterval: 86_400,
    });

    // 2-hour outage within the measurement window
    const outageStart = now - 7_200_000; // 2 hours ago in ms
    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'breach-merchant',
        timestamp: outageStart,
        durationSeconds: 7_200,
        state: 'full_outage',
      },
    ];

    const status = calculateMerchantStatus(config, events, [], now);
    expect(status.compliant).toBe(false);
    expect(status.downtimeSeconds).toBeGreaterThan(0);
    expect(status.uptimePercentage).toBeLessThan(99.9);
  });

  it('excludes maintenance windows from downtime calculation', () => {
    const config = makeConfig({
      merchantId: 'maintenance-merchant',
      uptimeTarget: 99,
      measurementInterval: 86_400,
    });

    // 4-hour maintenance window
    const maintenanceStart = now - 14_400_000;
    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'maintenance-merchant',
        timestamp: maintenanceStart,
        durationSeconds: 14_400,
        state: 'maintenance',
      },
    ];

    const status = calculateMerchantStatus(config, events, [], now);
    expect(status.compliant).toBe(true);
    expect(status.downtimeSeconds).toBe(0);
    expect(status.maintenanceSeconds).toBeGreaterThan(0);
  });

  it('counts partial outage at 50% weight', () => {
    const config = makeConfig({
      merchantId: 'partial-merchant',
      uptimeTarget: 99.9,
      measurementInterval: 86_400,
    });

    // 2-hour partial outage
    const partialStart = now - 7_200_000;
    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'partial-merchant',
        timestamp: partialStart,
        durationSeconds: 7_200,
        state: 'partial_outage',
      },
    ];

    const status = calculateMerchantStatus(config, events, [], now);
    // Downtime should be 50% of 7200 = 3600 seconds
    expect(status.downtimeSeconds).toBeCloseTo(3_600, 0);
    expect(status.partialOutageSeconds).toBeCloseTo(7_200, 0);
  });

  it('ignores events outside the measurement window', () => {
    const config = makeConfig({
      merchantId: 'window-merchant',
      uptimeTarget: 99,
      measurementInterval: 3_600, // 1-hour window
    });

    // Event that ended 2 hours ago — outside the 1-hour window
    const oldEventStart = now - 7_200_000;
    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'window-merchant',
        timestamp: oldEventStart,
        durationSeconds: 3_600,
        state: 'full_outage',
      },
    ];

    const status = calculateMerchantStatus(config, events, [], now);
    expect(status.observedSeconds).toBe(0);
    expect(status.compliant).toBe(true);
  });

  it('tracks active breach ID from existing breaches', () => {
    const config = makeConfig({ merchantId: 'active-breach-merchant' });
    const breach = makeBreach({
      merchantId: 'active-breach-merchant',
      resolvedAt: null,
    });

    const status = calculateMerchantStatus(config, [], [breach], now);
    expect(status.activeBreachId).toBe(breach.id);
  });

  it('reports null activeBreachId when all breaches are resolved', () => {
    const config = makeConfig({ merchantId: 'resolved-merchant' });
    const breach = makeBreach({
      merchantId: 'resolved-merchant',
      resolvedAt: now - 1_000,
    });

    const status = calculateMerchantStatus(config, [], [breach], now);
    expect(status.activeBreachId).toBeNull();
  });

  it('sums credit balance from all breaches', () => {
    const config = makeConfig({ merchantId: 'credit-merchant' });
    const breaches = [
      makeBreach({ merchantId: 'credit-merchant', creditAmount: 100 }),
      makeBreach({ merchantId: 'credit-merchant', creditAmount: 250 }),
    ];

    const status = calculateMerchantStatus(config, [], breaches, now);
    expect(status.creditBalance).toBe(350);
  });
});

// ---------------------------------------------------------------------------
// evaluateMerchantSnapshot — breach lifecycle
// ---------------------------------------------------------------------------

describe('evaluateMerchantSnapshot', () => {
  const now = 1_700_000_000_000;

  it('creates a new breach when uptime drops below target', () => {
    const config = makeConfig({
      merchantId: 'snap-breach',
      uptimeTarget: 99.9,
      measurementInterval: 86_400,
    });

    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'snap-breach',
        timestamp: now - 7_200_000,
        durationSeconds: 7_200,
        state: 'full_outage',
      },
    ];

    const result = evaluateMerchantSnapshot({ config, events, breaches: [], now });

    expect(result.createdBreach).not.toBeNull();
    expect(result.createdBreach!.creditAmount).toBeGreaterThan(0);
    expect(result.createdBreach!.merchantId).toBe('snap-breach');
    expect(result.breaches).toHaveLength(1);
    expect(result.status.activeBreachId).toBe(result.createdBreach!.id);
  });

  it('does not create a duplicate breach when one is already open', () => {
    const config = makeConfig({
      merchantId: 'snap-dup',
      uptimeTarget: 99.9,
      measurementInterval: 86_400,
    });

    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'snap-dup',
        timestamp: now - 7_200_000,
        durationSeconds: 7_200,
        state: 'full_outage',
      },
    ];

    const existingBreach = makeBreach({
      merchantId: 'snap-dup',
      resolvedAt: null,
    });

    const result = evaluateMerchantSnapshot({
      config,
      events,
      breaches: [existingBreach],
      now,
    });

    expect(result.createdBreach).toBeNull();
    expect(result.breaches).toHaveLength(1);
  });

  it('resolves an open breach when uptime recovers above target', () => {
    const config = makeConfig({
      merchantId: 'snap-resolve',
      uptimeTarget: 99,
      measurementInterval: 86_400,
    });

    // No events → 100% uptime → compliant
    const openBreach = makeBreach({
      merchantId: 'snap-resolve',
      resolvedAt: null,
    });

    const result = evaluateMerchantSnapshot({
      config,
      events: [],
      breaches: [openBreach],
      now,
    });

    expect(result.resolvedBreachId).toBe(openBreach.id);
    expect(result.createdBreach).toBeNull();
    const resolved = result.breaches.find((b) => b.id === openBreach.id);
    expect(resolved?.resolvedAt).not.toBeNull();
  });

  it('returns no changes when already compliant with no open breach', () => {
    const config = makeConfig({ merchantId: 'snap-stable' });

    const result = evaluateMerchantSnapshot({
      config,
      events: [],
      breaches: [],
      now,
    });

    expect(result.createdBreach).toBeNull();
    expect(result.resolvedBreachId).toBeNull();
    expect(result.status.compliant).toBe(true);
  });

  it('calculates credit amount proportional to the deficit', () => {
    const config = makeConfig({
      merchantId: 'snap-credit',
      uptimeTarget: 99.9,
      measurementInterval: 86_400,
    });

    // 3-hour outage
    const events: SlaAvailabilityEvent[] = [
      {
        id: nextId(),
        merchantId: 'snap-credit',
        timestamp: now - 10_800_000,
        durationSeconds: 10_800,
        state: 'full_outage',
      },
    ];

    const result = evaluateMerchantSnapshot({ config, events, breaches: [], now });
    expect(result.createdBreach!.creditAmount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// buildSlaDashboardReport — enterprise reporting
// ---------------------------------------------------------------------------

describe('buildSlaDashboardReport', () => {
  const now = Date.now();

  const makeStatus = (merchantId: string, compliant: boolean, uptime = 99.5): SlaStatus => ({
    merchantId,
    uptimeTarget: 99,
    measurementInterval: 86_400,
    observedSeconds: 86_400,
    uptimePercentage: uptime,
    downtimeSeconds: compliant ? 0 : 3_600,
    partialOutageSeconds: 0,
    maintenanceSeconds: 0,
    breachCount: compliant ? 0 : 1,
    activeBreachId: compliant ? null : 'breach-1',
    creditBalance: compliant ? 0 : 100,
    compliant,
    lastUpdatedAt: now,
    lastBreachAt: compliant ? null : now - 3_600_000,
  });

  it('reports correct total and compliant merchant counts', () => {
    const configs = {
      m1: makeConfig({ merchantId: 'm1' }),
      m2: makeConfig({ merchantId: 'm2' }),
      m3: makeConfig({ merchantId: 'm3' }),
    };
    const statuses = {
      m1: makeStatus('m1', true),
      m2: makeStatus('m2', false),
      m3: makeStatus('m3', true),
    };

    const report = buildSlaDashboardReport({
      configs,
      statuses,
      breaches: [],
      events: [],
    });

    expect(report.summary.totalMerchants).toBe(3);
    expect(report.summary.compliantMerchants).toBe(2);
  });

  it('counts only open (unresolved) breaches', () => {
    const configs = { m1: makeConfig({ merchantId: 'm1' }) };
    const statuses = { m1: makeStatus('m1', false) };
    const breaches: SlaBreach[] = [
      makeBreach({ merchantId: 'm1', resolvedAt: null }),
      makeBreach({ merchantId: 'm1', resolvedAt: now - 1_000 }), // resolved
    ];

    const report = buildSlaDashboardReport({ configs, statuses, breaches, events: [] });
    expect(report.summary.breachCount).toBe(1);
  });

  it('calculates average uptime across all merchants', () => {
    const configs = {
      m1: makeConfig({ merchantId: 'm1' }),
      m2: makeConfig({ merchantId: 'm2' }),
    };
    const statuses = {
      m1: makeStatus('m1', true, 100),
      m2: makeStatus('m2', false, 90),
    };

    const report = buildSlaDashboardReport({ configs, statuses, breaches: [], events: [] });
    expect(report.summary.averageUptime).toBeCloseTo(95, 1);
  });

  it('returns 100% average uptime when no merchants are configured', () => {
    const report = buildSlaDashboardReport({
      configs: {},
      statuses: {},
      breaches: [],
      events: [],
    });
    expect(report.summary.averageUptime).toBe(100);
    expect(report.summary.totalMerchants).toBe(0);
  });

  it('sums total credits issued across all breaches', () => {
    const configs = { m1: makeConfig({ merchantId: 'm1' }) };
    const statuses = { m1: makeStatus('m1', false) };
    const breaches: SlaBreach[] = [
      makeBreach({ merchantId: 'm1', creditAmount: 200 }),
      makeBreach({ merchantId: 'm1', creditAmount: 350 }),
    ];

    const report = buildSlaDashboardReport({ configs, statuses, breaches, events: [] });
    expect(report.summary.totalCreditsIssued).toBe(550);
  });

  it('counts partial outage and maintenance events separately', () => {
    const configs = { m1: makeConfig({ merchantId: 'm1' }) };
    const statuses = { m1: makeStatus('m1', true) };
    const events: SlaAvailabilityEvent[] = [
      makeEvent({ merchantId: 'm1', state: 'partial_outage' }),
      makeEvent({ merchantId: 'm1', state: 'partial_outage' }),
      makeEvent({ merchantId: 'm1', state: 'maintenance' }),
      makeEvent({ merchantId: 'm1', state: 'healthy' }),
    ];

    const report = buildSlaDashboardReport({ configs, statuses, breaches: [], events });
    expect(report.summary.partialOutageEvents).toBe(2);
    expect(report.summary.maintenanceEvents).toBe(1);
  });

  it('includes configs, statuses, breaches, and events in the report', () => {
    const configs = { m1: makeConfig({ merchantId: 'm1' }) };
    const statuses = { m1: makeStatus('m1', true) };
    const breaches = [makeBreach({ merchantId: 'm1' })];
    const events = [makeEvent({ merchantId: 'm1' })];

    const report = buildSlaDashboardReport({ configs, statuses, breaches, events });

    expect(report.configs).toEqual(configs);
    expect(report.statuses).toEqual(statuses);
    expect(report.breaches).toHaveLength(1);
    expect(report.events).toHaveLength(1);
  });
});
