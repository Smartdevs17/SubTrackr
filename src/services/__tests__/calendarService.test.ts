import { describe, expect, it } from '@jest/globals';

import {
  beginCalendarOAuth,
  buildSubscriptionCalendarEvent,
  connectCalendar,
  createCalendarOAuthCallbackUrl,
  syncToCalendar,
} from '../calendarService';
import { BillingCycle, SubscriptionCategory, type Subscription } from '../../types/subscription';

const baseSubscription: Subscription = {
  id: 'sub-1',
  name: 'Netflix',
  category: SubscriptionCategory.STREAMING,
  price: 15.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-06-15T09:00:00.000Z'),
  isActive: true,
  notificationsEnabled: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('calendarService', () => {
  it('builds a provider authorization URL with state tracking', () => {
    const authorization = beginCalendarOAuth('google');

    expect(authorization.provider).toBe('google');
    expect(authorization.state).toContain('google_state');
    expect(authorization.authorizationUrl).toContain('accounts.google.com');
    expect(authorization.authorizationUrl).toContain(encodeURIComponent(authorization.state));
  });

  it('connects a calendar after OAuth bootstrap and returns the required access token', async () => {
    const authorization = beginCalendarOAuth('outlook');
    const callbackUrl = createCalendarOAuthCallbackUrl('outlook', authorization);
    const integration = await connectCalendar('outlook', authorization, callbackUrl);

    expect(integration.provider).toBe('outlook');
    expect(integration.access_token).toContain('outlook_token');
    expect(integration.status).toBe('connected');
  });

  it('rejects callbacks whose state does not match the pending authorization', async () => {
    const authorization = beginCalendarOAuth('google');
    const callbackUrl = createCalendarOAuthCallbackUrl('google', authorization).replace(
      authorization.state,
      'google_state_tampered'
    );

    await expect(connectCalendar('google', authorization, callbackUrl)).rejects.toThrow(
      'Calendar callback state mismatch for google.'
    );
  });

  it('builds billing event templates with normalized reminder offsets', () => {
    const event = buildSubscriptionCalendarEvent(baseSubscription, [60, 24 * 60, 7 * 24 * 60]);

    expect(event.title).toBe('Netflix renewal');
    expect(event.reminderOffsets).toEqual([7 * 24 * 60, 24 * 60, 60]);
    expect(event.notes).toContain('Expected charge: USD 15.99.');
  });

  it('upserts provider events instead of duplicating them on repeated syncs', async () => {
    const authorization = beginCalendarOAuth('apple');
    const callbackUrl = createCalendarOAuthCallbackUrl('apple', authorization);
    const integration = await connectCalendar('apple', authorization, callbackUrl);
    const firstTemplate = buildSubscriptionCalendarEvent(baseSubscription, [24 * 60, 60]);
    const firstSync = await syncToCalendar(baseSubscription.id, [firstTemplate], integration, []);

    const nextCycleSubscription = {
      ...baseSubscription,
      nextBillingDate: new Date('2026-07-15T09:00:00.000Z'),
    };
    const secondTemplate = buildSubscriptionCalendarEvent(nextCycleSubscription, [24 * 60, 60]);
    const secondSync = await syncToCalendar(
      baseSubscription.id,
      [secondTemplate],
      integration,
      firstSync
    );

    expect(secondSync).toHaveLength(1);
    expect(secondSync[0].providerEventId).toBe(firstSync[0].providerEventId);
    expect(secondSync[0].id).toBe(firstSync[0].id);
    expect(secondSync[0].startAt).toBe('2026-07-15T09:00:00.000Z');
  });
});
