/**
 * Tests for src/store/slices/calendarSlice.ts (issue #2045).
 *
 * Run with:
 *   npx jest --config jest.backend.config.js \
 *     --testMatch '**\/src\/store\/__tests__\/calendarSlice.test.ts'
 */

import { act } from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { useAppStore } from '../slices';
import { createCalendarOAuthCallbackUrl } from '../../services/calendarService';
import { BillingCycle, SubscriptionCategory, type Subscription } from '../../types/subscription';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const reset = () =>
  useAppStore.setState({
    calendarIntegrations: [],
    calendarSyncedEvents: [],
    calendarReminderOffsets: [24 * 60, 60],
    calendarPendingAuthorizations: {},
    calendarIsLoading: false,
    calendarError: null,
    calendarOneTimePayments: [],
    calendarScheduleConflicts: [],
    calendarTimezone: 'UTC',
  });

const subscription: Subscription = {
  id: 'sub-1',
  name: 'Spotify',
  category: SubscriptionCategory.STREAMING,
  price: 9.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-06-20T10:00:00.000Z'),
  isActive: true,
  notificationsEnabled: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

// ─── slice composition ────────────────────────────────────────────────────────

describe('calendarSlice — composition', () => {
  beforeEach(reset);

  it('is composed into useAppStore with correct initial state', () => {
    const s = useAppStore.getState();
    expect(s.calendarIntegrations).toEqual([]);
    expect(s.calendarSyncedEvents).toEqual([]);
    expect(s.calendarIsLoading).toBe(false);
    expect(s.calendarError).toBeNull();
    expect(s.calendarTimezone).toBe('UTC');
  });

  it('exposes every calendar action on the combined store', () => {
    const s = useAppStore.getState();
    for (const fn of [
      'beginCalendarConnection',
      'completeCalendarConnection',
      'handleCalendarOAuthRedirect',
      'cancelCalendarConnection',
      'disconnectCalendarConnection',
      'setCalendarReminderOffsets',
      'toggleCalendarReminderOffset',
      'clearCalendarError',
      'syncSubscriptionToCalendars',
      'syncSubscriptions',
      'removeSubscriptionFromCalendars',
      'addCalendarOneTimePayment',
      'cancelCalendarOneTimePayment',
      'getCalendarOneTimePayments',
      'checkCalendarConflicts',
      'exportCalendar',
      'calculateProratedCharge',
      'setCalendarTimezone',
    ]) {
      expect(typeof (s as Record<string, unknown>)[fn]).toBe('function');
    }
  });
});

// ─── OAuth flow ───────────────────────────────────────────────────────────────

describe('OAuth connection flow', () => {
  beforeEach(reset);

  it('beginCalendarConnection stores a pending authorization', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
    });
    expect(useAppStore.getState().calendarPendingAuthorizations.google).toBeDefined();
  });

  it('completeCalendarConnection stores the integration and clears pending state', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
    });
    const s = useAppStore.getState();
    expect(s.calendarIntegrations).toHaveLength(1);
    expect(s.calendarIntegrations[0].provider).toBe('google');
    expect(s.calendarPendingAuthorizations.google).toBeUndefined();
  });

  it('replaces an existing integration on reconnect for the same provider', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
    });
    expect(useAppStore.getState().calendarIntegrations).toHaveLength(1);
  });

  it('handleCalendarOAuthRedirect resolves the matching provider by state', async () => {
    await act(async () => {
      const authorization = await useAppStore.getState().beginCalendarConnection('apple');
      const callbackUrl = createCalendarOAuthCallbackUrl('apple', authorization);
      await useAppStore.getState().handleCalendarOAuthRedirect(callbackUrl);
    });
    const s = useAppStore.getState();
    expect(s.calendarIntegrations).toHaveLength(1);
    expect(s.calendarIntegrations[0].provider).toBe('apple');
    expect(s.calendarPendingAuthorizations.apple).toBeUndefined();
  });

  it('handleCalendarOAuthRedirect returns null for unknown state', async () => {
    let result: unknown;
    await act(async () => {
      result = await useAppStore
        .getState()
        .handleCalendarOAuthRedirect('subtrackr://callback?state=unknown&code=x');
    });
    expect(result).toBeNull();
  });

  it('cancelCalendarConnection removes the pending authorization', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('outlook');
    });
    useAppStore.getState().cancelCalendarConnection('outlook');
    expect(useAppStore.getState().calendarPendingAuthorizations.outlook).toBeUndefined();
  });

  it('completeCalendarConnection throws when no pending session exists', async () => {
    await expect(useAppStore.getState().completeCalendarConnection('google')).rejects.toThrow(
      /No pending OAuth session/
    );
  });
});

// ─── disconnectCalendarConnection ────────────────────────────────────────────

describe('disconnectCalendarConnection', () => {
  beforeEach(reset);

  it('removes the integration and its synced events', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      const integration = await useAppStore.getState().completeCalendarConnection('google');
      await useAppStore.getState().syncSubscriptionToCalendars(subscription);
      await useAppStore.getState().disconnectCalendarConnection(integration.id);
    });
    const s = useAppStore.getState();
    expect(s.calendarIntegrations).toHaveLength(0);
    expect(s.calendarSyncedEvents).toHaveLength(0);
  });
});

// ─── reminder offsets ─────────────────────────────────────────────────────────

describe('reminder offsets', () => {
  beforeEach(reset);

  it('setCalendarReminderOffsets normalizes and propagates to integrations', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
      useAppStore.getState().setCalendarReminderOffsets([7 * 24 * 60, 60]);
    });
    const s = useAppStore.getState();
    expect(s.calendarReminderOffsets).toEqual([7 * 24 * 60, 60]);
    expect(s.calendarIntegrations[0].reminderOffsets).toEqual([7 * 24 * 60, 60]);
  });

  it('toggleCalendarReminderOffset adds an offset that is not present', () => {
    useAppStore.setState({ calendarReminderOffsets: [60] });
    useAppStore.getState().toggleCalendarReminderOffset(120);
    expect(useAppStore.getState().calendarReminderOffsets).toContain(120);
  });

  it('toggleCalendarReminderOffset removes an offset that is already present', () => {
    useAppStore.setState({ calendarReminderOffsets: [60, 120] });
    useAppStore.getState().toggleCalendarReminderOffset(60);
    expect(useAppStore.getState().calendarReminderOffsets).not.toContain(60);
  });
});

// ─── sync ─────────────────────────────────────────────────────────────────────

describe('syncSubscriptionToCalendars', () => {
  beforeEach(reset);

  it('creates a synced event for an active subscription', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('outlook');
      await useAppStore.getState().completeCalendarConnection('outlook');
      await useAppStore.getState().syncSubscriptionToCalendars(subscription);
    });
    const s = useAppStore.getState();
    expect(s.calendarSyncedEvents).toHaveLength(1);
    expect(s.calendarSyncedEvents[0].subscriptionId).toBe('sub-1');
    expect(s.calendarSyncedEvents[0].title).toBe('Spotify renewal');
  });

  it('removes events when syncing an inactive subscription', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
      await useAppStore.getState().syncSubscriptionToCalendars(subscription);
      await useAppStore.getState().syncSubscriptionToCalendars({
        ...subscription,
        isActive: false,
      });
    });
    expect(useAppStore.getState().calendarSyncedEvents).toHaveLength(0);
  });

  it('is a no-op when no integrations are connected', async () => {
    await act(async () => {
      await useAppStore.getState().syncSubscriptionToCalendars(subscription);
    });
    expect(useAppStore.getState().calendarSyncedEvents).toHaveLength(0);
  });
});

describe('removeSubscriptionFromCalendars', () => {
  beforeEach(reset);

  it('removes all events for the given subscription', async () => {
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('apple');
      await useAppStore.getState().completeCalendarConnection('apple');
      await useAppStore.getState().syncSubscriptionToCalendars(subscription);
      await useAppStore.getState().removeSubscriptionFromCalendars('sub-1');
    });
    expect(useAppStore.getState().calendarSyncedEvents).toHaveLength(0);
  });
});

// ─── one-time payments ────────────────────────────────────────────────────────

describe('one-time payments', () => {
  beforeEach(reset);

  it('adds a pending one-time payment', () => {
    useAppStore
      .getState()
      .addCalendarOneTimePayment('sub-1', 50, 'USD', new Date('2026-07-01'), 'Annual fee');
    const payments = useAppStore.getState().getCalendarOneTimePayments();
    expect(payments).toHaveLength(1);
    expect(payments[0].subscriptionId).toBe('sub-1');
    expect(payments[0].status).toBe('pending');
  });

  it('cancels a pending one-time payment', () => {
    useAppStore
      .getState()
      .addCalendarOneTimePayment('sub-1', 50, 'USD', new Date('2026-07-01'), 'Annual fee');
    const id = useAppStore.getState().calendarOneTimePayments[0].id;
    useAppStore.getState().cancelCalendarOneTimePayment(id);
    expect(useAppStore.getState().calendarOneTimePayments[0].status).toBe('cancelled');
  });
});

// ─── conflict detection ───────────────────────────────────────────────────────

describe('checkCalendarConflicts', () => {
  beforeEach(reset);

  it('detects no conflicts when subscriptions have different billing dates', () => {
    const s2: Subscription = {
      ...subscription,
      id: 'sub-2',
      nextBillingDate: new Date('2026-07-05'),
    };
    useAppStore.getState().checkCalendarConflicts([subscription, s2]);
    expect(useAppStore.getState().calendarScheduleConflicts).toHaveLength(0);
  });
});

// ─── exportCalendar ───────────────────────────────────────────────────────────

describe('exportCalendar', () => {
  it('returns a payload with ical content and events', () => {
    const payload = useAppStore.getState().exportCalendar([subscription]);
    expect(typeof payload.ical).toBe('string');
    expect(payload.ical.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events.length).toBe(1);
  });

  it('filters out inactive subscriptions', () => {
    const inactive = { ...subscription, isActive: false };
    const payload = useAppStore.getState().exportCalendar([inactive]);
    expect(payload.events).toHaveLength(0);
  });
});

// ─── calculateProratedCharge ──────────────────────────────────────────────────

describe('calculateProratedCharge', () => {
  it('returns a ProratedAdjustment with numeric fields', () => {
    const adj = useAppStore
      .getState()
      .calculateProratedCharge(subscription, new Date('2026-06-25'), 'plan change');
    expect(typeof adj.originalAmount).toBe('number');
    expect(typeof adj.proratedAmount).toBe('number');
    expect(typeof adj.daysRemaining).toBe('number');
    expect(typeof adj.reason).toBe('string');
  });
});

// ─── timezone ────────────────────────────────────────────────────────────────

describe('setCalendarTimezone', () => {
  it('updates the timezone', () => {
    useAppStore.getState().setCalendarTimezone('America/New_York');
    expect(useAppStore.getState().calendarTimezone).toBe('America/New_York');
  });
});

// ─── clearCalendarError ───────────────────────────────────────────────────────

describe('clearCalendarError', () => {
  it('resets calendarError to null', () => {
    useAppStore.setState({ calendarError: 'oops' });
    useAppStore.getState().clearCalendarError();
    expect(useAppStore.getState().calendarError).toBeNull();
  });
});

// ─── slice isolation ─────────────────────────────────────────────────────────

describe('slice isolation', () => {
  beforeEach(reset);

  it('calendar mutations leave billing schedules untouched', async () => {
    useAppStore.setState({ billingSchedules: { m1: { merchantId: 'm1' } as never } });
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
    });
    expect(useAppStore.getState().billingSchedules['m1']).toBeDefined();
  });

  it('calendar mutations leave auth state untouched', async () => {
    useAppStore.setState({ token: 'tok-xyz', isAuthenticated: true });
    await act(async () => {
      await useAppStore.getState().beginCalendarConnection('google');
      await useAppStore.getState().completeCalendarConnection('google');
    });
    expect(useAppStore.getState().token).toBe('tok-xyz');
  });
});
