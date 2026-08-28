/**
 * Tests for the SLA enforcement dashboard (issue: build subscription SLA
 * monitoring with breach detection).
 * Technical scope: src/screens/SlaDashboard.tsx
 *
 * We test the slaStore — the data layer behind the dashboard — directly,
 * since rendering the screen requires the full RN environment (same approach
 * as FraudDashboard.test.ts). Every assertion targets a value the dashboard
 * renders: report summary cards, the merchant status panel, and the breach list.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSlaStore } from '../../store/slaStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
  };
});

jest.mock('../../services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
  presentLocalNotification: jest.fn(() => Promise.resolve()),
  presentSlaBreachNotification: jest.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyReport = () => ({
  summary: {
    totalMerchants: 0,
    compliantMerchants: 0,
    breachCount: 0,
    averageUptime: 100,
    totalCreditsIssued: 0,
    partialOutageEvents: 0,
    maintenanceEvents: 0,
  },
  configs: {},
  statuses: {},
  breaches: [],
  events: [],
});

const resetStore = () => {
  useSlaStore.setState({
    configs: {},
    statuses: {},
    availabilityEvents: [],
    breaches: [],
    report: emptyReport(),
    isLoading: false,
    error: null,
  });
};

const s = () => useSlaStore.getState();

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  resetStore();
});

// ---------------------------------------------------------------------------
// Dashboard summary cards
// ---------------------------------------------------------------------------

describe('SlaDashboard — summary cards', () => {
  it('shows default values for an empty dashboard', () => {
    const report = s().report;
    expect(report.summary.averageUptime).toBe(100);
    expect(report.summary.breachCount).toBe(0);
    expect(report.summary.totalCreditsIssued).toBe(0);
    expect(report.summary.compliantMerchants).toBe(0);
    expect(report.summary.totalMerchants).toBe(0);
    // Reporting snapshot section
    expect(report.summary.partialOutageEvents).toBe(0);
    expect(report.summary.maintenanceEvents).toBe(0);
  });

  it('updates the summary cards after configuring a merchant SLA', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', { uptimeTarget: 99, measurementInterval: 86_400 });
    });

    const report = s().report;
    expect(report.summary.totalMerchants).toBe(1);
    expect(report.summary.compliantMerchants).toBe(1);
    expect(report.summary.averageUptime).toBe(100);
    expect(report.configs['merchant-demo']).toBeDefined();
  });

  it('reflects an outage in the summary cards', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', {
        uptimeTarget: 99.9,
        measurementInterval: 86_400,
      });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-demo', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
    });

    const report = s().report;
    expect(report.summary.breachCount).toBe(1);
    expect(report.summary.compliantMerchants).toBe(0);
    expect(report.summary.averageUptime).toBeLessThan(99.9);
    expect(report.summary.totalCreditsIssued).toBeGreaterThan(0);
  });

  it('counts partial outages and maintenance in the reporting snapshot', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', { uptimeTarget: 99, measurementInterval: 86_400 });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-demo', {
        durationSeconds: 1_800,
        state: 'partial_outage',
      });
      await s().trackServiceAvailability('merchant-demo', {
        durationSeconds: 3_600,
        state: 'maintenance',
      });
    });

    const summary = s().report.summary;
    expect(summary.partialOutageEvents).toBe(1);
    expect(summary.maintenanceEvents).toBe(1);
    // The partial outage (weighted 50%) drops uptime below the 99% target, so
    // a breach is correctly opened — maintenance alone never breaches.
    expect(summary.breachCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Merchant status panel
// ---------------------------------------------------------------------------

describe('SlaDashboard — merchant status panel', () => {
  it('shows Idle for a merchant without a configured SLA', () => {
    expect(s().getSlaStatus('unknown-merchant')).toBeNull();
  });

  it('shows a compliant status panel after configuration', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', {
        uptimeTarget: 99,
        measurementInterval: 86_400,
        creditCap: 500,
      });
    });

    const status = s().getSlaStatus('merchant-demo');
    expect(status).not.toBeNull();
    expect(status!.compliant).toBe(true);
    expect(status!.uptimeTarget).toBe(99);
    expect(status!.measurementInterval).toBe(86_400);
    expect(status!.observedSeconds).toBe(0);
    expect(status!.downtimeSeconds).toBe(0);
    expect(status!.creditBalance).toBe(0);
    expect(status!.activeBreachId).toBeNull();
  });

  it('shows a breached status panel with downtime and credits after an outage', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', {
        uptimeTarget: 99.9,
        measurementInterval: 86_400,
      });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-demo', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
    });

    const status = s().getSlaStatus('merchant-demo');
    expect(status!.compliant).toBe(false);
    expect(status!.uptimePercentage).toBeLessThan(99.9);
    expect(status!.downtimeSeconds).toBe(7_200);
    expect(status!.creditBalance).toBeGreaterThan(0);
    expect(status!.activeBreachId).not.toBeNull();
  });

  it('shows partial outage seconds for degraded service', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', { uptimeTarget: 99, measurementInterval: 86_400 });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-demo', {
        durationSeconds: 7_200,
        state: 'partial_outage',
      });
    });

    const status = s().getSlaStatus('merchant-demo');
    expect(status!.partialOutageSeconds).toBe(7_200);
    // Partial outages count at 50% toward downtime.
    expect(status!.downtimeSeconds).toBe(3_600);
  });

  it('excludes maintenance from the status panel measurement', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', { uptimeTarget: 99, measurementInterval: 86_400 });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-demo', {
        durationSeconds: 3_600,
        state: 'maintenance',
      });
    });

    const status = s().getSlaStatus('merchant-demo');
    expect(status!.maintenanceSeconds).toBe(3_600);
    expect(status!.compliant).toBe(true);
    expect(status!.downtimeSeconds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Breach list
// ---------------------------------------------------------------------------

describe('SlaDashboard — breach list', () => {
  it('shows no breaches for a merchant that never breached', async () => {
    await act(async () => {
      await s().configureSla('merchant-demo', { uptimeTarget: 99, measurementInterval: 86_400 });
    });
    expect(s().breaches.filter((b) => b.merchantId === 'merchant-demo')).toHaveLength(0);
  });

  it('lists only the selected merchant’s breaches', async () => {
    await act(async () => {
      await s().configureSla('merchant-a', { uptimeTarget: 99.9, measurementInterval: 86_400 });
      await s().configureSla('merchant-b', { uptimeTarget: 99.9, measurementInterval: 86_400 });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-a', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
      await s().trackServiceAvailability('merchant-b', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
    });

    // The dashboard filters breaches by the selected merchant.
    const merchantABreaches = s().breaches.filter((b) => b.merchantId === 'merchant-a');
    const merchantBBreaches = s().breaches.filter((b) => b.merchantId === 'merchant-b');
    expect(merchantABreaches).toHaveLength(1);
    expect(merchantBBreaches).toHaveLength(1);
    expect(s().breaches).toHaveLength(2);

    const breach = merchantABreaches[0];
    expect(breach.resolvedAt).toBeNull();
    expect(breach.uptimeTarget).toBe(99.9);
    expect(breach.uptimePercentage).toBeLessThan(99.9);
    expect(breach.downtimeSeconds).toBeGreaterThan(0);
    expect(breach.creditAmount).toBeGreaterThan(0);
    expect(typeof breach.detectedAt).toBe('number');
  });

  it('marks a breach acknowledged when the user acknowledges it', async () => {
    await act(async () => {
      await s().configureSla('merchant-a', { uptimeTarget: 99.9, measurementInterval: 86_400 });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-a', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
    });
    const breachId = s().breaches[0].id;

    await act(async () => {
      await s().acknowledgeBreach(breachId);
    });

    expect(s().breaches.find((b) => b.id === breachId)!.acknowledged).toBe(true);
  });

  it('shows a breach as resolved once uptime recovers to target', async () => {
    await act(async () => {
      await s().configureSla('merchant-a', { uptimeTarget: 99, measurementInterval: 86_400 });
    });
    // 7 200s full outage → 0% uptime → breach.
    await act(async () => {
      await s().trackServiceAvailability('merchant-a', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
    });
    expect(s().breaches.filter((b) => b.merchantId === 'merchant-a')).toHaveLength(1);

    // 712 800s of healthy uptime brings observed uptime back to 99% → resolved.
    await act(async () => {
      await s().trackServiceAvailability('merchant-a', {
        durationSeconds: 712_800,
        state: 'healthy',
      });
    });

    const status = s().getSlaStatus('merchant-a');
    expect(status!.compliant).toBe(true);
    expect(status!.activeBreachId).toBeNull();
    const breach = s().breaches.find((b) => b.merchantId === 'merchant-a')!;
    expect(breach.resolvedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

describe('SlaDashboard — refresh', () => {
  it('rebuilds the report from current state on refresh', async () => {
    await act(async () => {
      await s().configureSla('merchant-a', { uptimeTarget: 99, measurementInterval: 86_400 });
      await s().configureSla('merchant-b', { uptimeTarget: 99.5, measurementInterval: 86_400 });
    });
    await act(async () => {
      await s().trackServiceAvailability('merchant-a', {
        durationSeconds: 7_200,
        state: 'full_outage',
      });
    });

    s().refreshReport();

    const report = s().report;
    expect(report.summary.totalMerchants).toBe(2);
    expect(report.summary.compliantMerchants).toBe(1);
    expect(report.summary.breachCount).toBe(1);
    expect(Object.keys(report.configs)).toHaveLength(2);
    expect(report.statuses['merchant-a']).toBeDefined();
    expect(report.statuses['merchant-b']).toBeDefined();
  });
});
