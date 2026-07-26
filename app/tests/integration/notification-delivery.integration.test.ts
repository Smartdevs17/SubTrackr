/**
 * Integration tests: notification delivery
 *
 * Verifies that the notificationService correctly schedules, cancels,
 * and presents notifications in response to subscription lifecycle events.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  syncRenewalReminders,
  presentChargeSuccessNotification,
  presentChargeFailedNotification,
  presentTransactionQueueNotification,
  requestNotificationPermissions,
  NOTIFICATION_DATA_TYPE,
} from '../../../src/services/notificationService';
import { makeSubscription, resetIdCounter } from './factories';
import { BillingCycle } from '../../../src/types/subscription';

// ── Platform: simulate iOS (notifications supported) ─────────────────────────
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// ── expo-notifications mock ───────────────────────────────────────────────────
jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-id')),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
}));

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockGetScheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockSetHandler = Notifications.setNotificationHandler as jest.Mock;
const mockSetChannel = Notifications.setNotificationChannelAsync as jest.Mock;

beforeEach(() => {
  mockSchedule.mockClear();
  mockGetScheduled.mockClear();
  mockCancel.mockClear();
  mockGetPermissions.mockClear();
  mockRequestPermissions.mockClear();
  mockSetHandler.mockClear();
  mockSetChannel.mockClear();
  resetIdCounter();
  // Reset handler flag between tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).__handlerConfigured = false;
});

// ═════════════════════════════════════════════════════════════════════════════
describe('notification delivery integration', () => {
  it('requestNotificationPermissions returns GRANTED when already granted', async () => {
    const status = await requestNotificationPermissions();
    expect(status).toBe(Notifications.PermissionStatus.GRANTED);
  });

  it('presentChargeSuccessNotification schedules an immediate notification', async () => {
    const sub = makeSubscription({ name: 'Linear', price: 8, currency: 'USD' });
    await presentChargeSuccessNotification(sub);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const [payload] = mockSchedule.mock.calls[0] as unknown as [
      { content: { title: string; data: { type: string } }; trigger: null },
    ];
    expect(payload.content.title).toContain('Linear');
    expect(payload.content.data.type).toBe(NOTIFICATION_DATA_TYPE.CHARGE_SUCCESS);
    expect(payload.trigger).toBeNull();
  });

  it('presentChargeFailedNotification schedules an immediate notification', async () => {
    const sub = makeSubscription({ name: 'Figma' });
    await presentChargeFailedNotification(sub);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const [payload] = mockSchedule.mock.calls[0] as unknown as [
      { content: { title: string; data: { type: string } }; trigger: null },
    ];
    expect(payload.content.title).toContain('Figma');
    expect(payload.content.data.type).toBe(NOTIFICATION_DATA_TYPE.CHARGE_FAILED);
    expect(payload.trigger).toBeNull();
  });

  it('presentChargeFailedNotification uses custom detail message when provided', async () => {
    const sub = makeSubscription();
    await presentChargeFailedNotification(sub, 'Insufficient balance');

    const [payload] = mockSchedule.mock.calls[0] as unknown as [{ content: { body: string } }];
    expect(payload.content.body).toBe('Insufficient balance');
  });

  it('presentTransactionQueueNotification schedules with correct type', async () => {
    await presentTransactionQueueNotification('Queue update', 'Your transaction was processed');

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const [payload] = mockSchedule.mock.calls[0] as unknown as [
      { content: { title: string; body: string; data: { type: string } } },
    ];
    expect(payload.content.title).toBe('Queue update');
    expect(payload.content.body).toBe('Your transaction was processed');
    expect(payload.content.data.type).toBe(NOTIFICATION_DATA_TYPE.TRANSACTION_QUEUE);
  });

  it('syncRenewalReminders cancels existing renewal reminders before rescheduling', async () => {
    const existingNotif = {
      identifier: 'old-notif-1',
      content: {
        title: 'Old reminder',
        body: '',
        data: { type: NOTIFICATION_DATA_TYPE.RENEWAL_REMINDER },
      },
      trigger: null,
    };
    mockGetScheduled.mockResolvedValueOnce([existingNotif] as never);

    const sub = makeSubscription({
      nextBillingDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // 2 days from now
      notificationsEnabled: true,
      isActive: true,
    });

    await syncRenewalReminders([sub]);

    expect(mockCancel).toHaveBeenCalledWith('old-notif-1');
  });

  it('syncRenewalReminders does not schedule for inactive subscriptions', async () => {
    mockGetScheduled.mockResolvedValueOnce([] as unknown as never);

    const sub = makeSubscription({ isActive: false, notificationsEnabled: true });
    await syncRenewalReminders([sub]);

    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('syncRenewalReminders does not schedule when notificationsEnabled is false', async () => {
    mockGetScheduled.mockResolvedValueOnce([] as unknown as never);

    const sub = makeSubscription({
      isActive: true,
      notificationsEnabled: false,
      nextBillingDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    await syncRenewalReminders([sub]);

    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('syncRenewalReminders schedules a reminder for an active sub with future billing date', async () => {
    mockGetScheduled.mockResolvedValueOnce([] as unknown as never);

    const sub = makeSubscription({
      isActive: true,
      notificationsEnabled: true,
      billingCycle: BillingCycle.MONTHLY,
      nextBillingDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // 2 days out
    });

    await syncRenewalReminders([sub]);

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const [payload] = mockSchedule.mock.calls[0] as unknown as [
      { content: { data: { type: string } } },
    ];
    expect(payload.content.data.type).toBe(NOTIFICATION_DATA_TYPE.RENEWAL_REMINDER);
  });

  it('notifications are skipped on unsupported platforms', async () => {
    // Temporarily override Platform.OS
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const sub = makeSubscription();
    await presentChargeSuccessNotification(sub);

    expect(mockSchedule).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });
});
