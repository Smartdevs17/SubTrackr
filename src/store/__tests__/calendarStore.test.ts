import { act } from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { useCalendarStore } from '../calendarStore';
import { createCalendarOAuthCallbackUrl } from '../../services/calendarService';
import { BillingCycle, SubscriptionCategory, type Subscription } from '../../types/subscription';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

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

describe('calendarStore', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      integrations: [],
      syncedEvents: [],
      reminderOffsets: [24 * 60, 60],
      pendingAuthorizations: {},
      isLoading: false,
      error: null,
    });
  });

  it('connects a provider and stores the integration', async () => {
    await act(async () => {
      await useCalendarStore.getState().beginConnection('google');
      await useCalendarStore.getState().completeConnection('google');
    });

    const state = useCalendarStore.getState();
    expect(state.integrations).toHaveLength(1);
    expect(state.integrations[0].provider).toBe('google');
    expect(state.integrations[0].access_token).toContain('google_token');
  });

  it('syncs an active subscription into provider events', async () => {
    await act(async () => {
      await useCalendarStore.getState().beginConnection('outlook');
      await useCalendarStore.getState().completeConnection('outlook');
      await useCalendarStore.getState().syncSubscriptionToCalendars(subscription);
    });

    const state = useCalendarStore.getState();
    expect(state.syncedEvents).toHaveLength(1);
    expect(state.syncedEvents[0].subscriptionId).toBe('sub-1');
    expect(state.syncedEvents[0].title).toBe('Spotify renewal');
  });

  it('completes a connection from an OAuth redirect callback', async () => {
    await act(async () => {
      const authorization = await useCalendarStore.getState().beginConnection('apple');
      const callbackUrl = createCalendarOAuthCallbackUrl('apple', authorization);
      await useCalendarStore.getState().handleOAuthRedirect(callbackUrl);
    });

    const state = useCalendarStore.getState();
    expect(state.integrations).toHaveLength(1);
    expect(state.integrations[0].provider).toBe('apple');
    expect(state.pendingAuthorizations.apple).toBeUndefined();
  });

  it('updates reminder offsets and applies them to synced events', async () => {
    await act(async () => {
      await useCalendarStore.getState().beginConnection('google');
      await useCalendarStore.getState().completeConnection('google');
      useCalendarStore.getState().setReminderOffsets([7 * 24 * 60, 60]);
      await useCalendarStore.getState().syncSubscriptionToCalendars(subscription);
    });

    const state = useCalendarStore.getState();
    expect(state.reminderOffsets).toEqual([7 * 24 * 60, 60]);
    expect(state.syncedEvents[0].reminderOffsets).toEqual([7 * 24 * 60, 60]);
    expect(state.integrations[0].reminderOffsets).toEqual([7 * 24 * 60, 60]);
  });

  it('removes synced events when a subscription is deleted', async () => {
    await act(async () => {
      await useCalendarStore.getState().beginConnection('apple');
      await useCalendarStore.getState().completeConnection('apple');
      await useCalendarStore.getState().syncSubscriptionToCalendars(subscription);
      await useCalendarStore.getState().removeSubscriptionFromCalendars(subscription.id);
    });

    expect(useCalendarStore.getState().syncedEvents).toHaveLength(0);
  });

  it('disconnects a connection and clears provider events', async () => {
    await act(async () => {
      await useCalendarStore.getState().beginConnection('google');
      const integration = await useCalendarStore.getState().completeConnection('google');
      await useCalendarStore.getState().syncSubscriptionToCalendars(subscription);
      await useCalendarStore.getState().disconnectConnection(integration.id);
    });

    const state = useCalendarStore.getState();
    expect(state.integrations).toHaveLength(0);
    expect(state.syncedEvents).toHaveLength(0);
  });
});
