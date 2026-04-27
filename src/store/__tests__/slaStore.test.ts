import { act } from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSlaStore } from '../slaStore';

const mockMemoryStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockMemoryStore.set(key, value);
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => Promise.resolve(mockMemoryStore.get(key) ?? null)),
  removeItem: jest.fn((key: string) => {
    mockMemoryStore.delete(key);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    mockMemoryStore.clear();
    return Promise.resolve();
  }),
}));

jest.mock('../../services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
  presentLocalNotification: jest.fn(() => Promise.resolve()),
  presentSlaBreachNotification: jest.fn(() => Promise.resolve()),
}));

describe('slaStore', () => {
  beforeEach(() => {
    mockMemoryStore.clear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();

    useSlaStore.setState({
      configs: {},
      statuses: {},
      availabilityEvents: [],
      breaches: [],
      report: {
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
      },
      isLoading: false,
      error: null,
    });
  });

  it('configures SLA targets and computes a healthy status', async () => {
    await act(async () => {
      await useSlaStore.getState().configureSla('merchant-a', {
        uptimeTarget: 99.5,
        measurementInterval: 86_400,
      });
    });

    const status = useSlaStore.getState().getSlaStatus('merchant-a');

    expect(status?.uptimeTarget).toBe(99.5);
    expect(status?.measurementInterval).toBe(86_400);
    expect(status?.compliant).toBe(true);
  });

  it('creates a breach and sends a notification when uptime drops below target', async () => {
    const notify = jest.requireMock('../../services/notificationService')
      .presentSlaBreachNotification as jest.Mock;

    await act(async () => {
      await useSlaStore.getState().configureSla('merchant-b', {
        uptimeTarget: 99.9,
        measurementInterval: 86_400,
      });
    });

    await act(async () => {
      await useSlaStore.getState().trackServiceAvailability('merchant-b', {
        durationSeconds: 7_200,
        state: 'full_outage',
        note: 'ISP incident',
      });
    });

    const status = useSlaStore.getState().getSlaStatus('merchant-b');
    const breaches = useSlaStore
      .getState()
      .breaches.filter((breach) => breach.merchantId === 'merchant-b');

    expect(status?.compliant).toBe(false);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].creditAmount).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('treats scheduled maintenance as non-breaching availability', async () => {
    await act(async () => {
      await useSlaStore.getState().configureSla('merchant-c', {
        uptimeTarget: 99,
        measurementInterval: 86_400,
      });
    });

    await act(async () => {
      await useSlaStore.getState().trackServiceAvailability('merchant-c', {
        durationSeconds: 3_600,
        state: 'maintenance',
        note: 'scheduled patching',
      });
    });

    const status = useSlaStore.getState().getSlaStatus('merchant-c');

    expect(status?.compliant).toBe(true);
    expect(status?.maintenanceSeconds).toBe(3_600);
    expect(useSlaStore.getState().breaches).toHaveLength(0);
  });
});
