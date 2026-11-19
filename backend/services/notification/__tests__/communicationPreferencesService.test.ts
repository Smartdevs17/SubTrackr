/**
 * Communication preferences (#1253)
 *
 * Covers: default materialisation, opt-in/opt-out, the regulatory "required
 * category" guard, quiet hours (including a window that wraps midnight),
 * channel routing with the fallback waterfall, and audit trail recording.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  CommunicationPreferenceService,
  InMemoryCommunicationPreferenceRepository,
  PreferenceViolationError,
  isWithinQuietHours,
  localMinutesOfDay,
  nextQuietHoursEnd,
  buildDefaultCommunicationPreferences,
} from '../communicationPreferencesService';
import { DEFAULT_QUIET_HOURS } from '../communicationPreferencesService';

const makeService = (now = new Date('2026-03-10T12:00:00.000Z')) => {
  const repository = new InMemoryCommunicationPreferenceRepository();
  return {
    repository,
    service: new CommunicationPreferenceService({ repository, now: () => now }),
  };
};

describe('buildDefaultCommunicationPreferences', () => {
  it('enables email for the required billing category and keeps voice opt-in', () => {
    const prefs = buildDefaultCommunicationPreferences('user-1');
    expect(prefs.categories.billing.required).toBe(true);
    expect(prefs.categories.billing.channels.email.enabled).toBe(true);
    expect(prefs.categories.billing.channels.voice.enabled).toBe(false);
    expect(prefs.quietHours).toEqual(DEFAULT_QUIET_HOURS);
  });
});

describe('CommunicationPreferenceService.getPreferences', () => {
  it('returns null-backed defaults on first call and persists them', async () => {
    const { service, repository } = makeService();
    expect(await repository.get('user-1')).toBeNull();

    const first = await service.getPreferences('user-1');
    expect(first.userId).toBe('user-1');
    expect(first.syncVersion).toBe(1);

    const second = await service.getPreferences('user-1');
    expect(second.updatedAt).toBe(first.updatedAt);
  });
});

describe('CommunicationPreferenceService.setChannelEnabled', () => {
  let service: CommunicationPreferenceService;
  let repository: InMemoryCommunicationPreferenceRepository;

  beforeEach(() => {
    ({ service, repository } = makeService());
  });

  it('enables a channel and records the change in the audit trail', async () => {
    const updated = await service.setChannelEnabled('user-1', 'marketing', 'sms', true);
    expect(updated.categories.marketing.channels.sms.enabled).toBe(true);
    expect(updated.syncVersion).toBe(2);

    const events = await repository.listEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: 'marketing',
      channel: 'sms',
      enabled: true,
      source: 'user',
    });
  });

  it('rejects disabling the last channel on a required category', async () => {
    // Billing starts with email + push enabled; turning both off must fail.
    await service.setChannelEnabled('user-1', 'billing', 'email', false);
    await expect(service.setChannelEnabled('user-1', 'billing', 'push', false)).rejects.toThrow(
      PreferenceViolationError
    );
  });

  it('rejects disabling a channel that is globally opted out', async () => {
    await service.optOutChannel('user-1', 'sms', 'stopped');
    await expect(service.setChannelEnabled('user-1', 'marketing', 'sms', false)).rejects.toThrow(
      /globally opted out/
    );
  });

  it('rejects an unknown category or channel', async () => {
    await expect(
      service.setChannelEnabled('user-1', 'nope' as never, 'sms', true)
    ).rejects.toThrow(/Unknown communication category/);
    await expect(
      service.setChannelEnabled('user-1', 'billing', 'carrier-pigeon' as never, true)
    ).rejects.toThrow(/Unknown communication channel/);
  });
});

describe('CommunicationPreferenceService.updatePreferences', () => {
  it('applies a category patch and quiet hours together', async () => {
    const { service } = makeService();
    const updated = await service.updatePreferences('user-1', {
      categories: { product: { voice: true } },
      quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'UTC' },
    });

    expect(updated.categories.product.channels.voice.enabled).toBe(true);
    expect(updated.quietHours.enabled).toBe(true);
  });

  it('rejects out-of-range quiet hours', async () => {
    const { service } = makeService();
    await expect(
      service.updatePreferences('user-1', { quietHours: { startMinute: 5000 } })
    ).rejects.toThrow(/between 0 and 1439/);
  });
});

describe('channel opt-out helpers', () => {
  it('round-trips a channel opt-out and opt-in', async () => {
    const { service } = makeService();
    const optedOut = await service.optOutChannel('user-1', 'voice', 'do not call');
    expect(optedOut.globalOptOuts.voice).toBe(true);

    const optedIn = await service.optInChannel('user-1', 'voice');
    expect(optedIn.globalOptOuts.voice).toBe(false);
  });
});

describe('quiet hours', () => {
  it('reports local minutes of day in the target timezone', () => {
    expect(localMinutesOfDay(new Date('2026-03-10T12:00:00.000Z'), 'UTC')).toBe(12 * 60);
    // Berlin is UTC+2 in March (DST).
    expect(localMinutesOfDay(new Date('2026-03-10T12:00:00.000Z'), 'Europe/Berlin')).toBe(14 * 60);
  });

  it('is disabled by default', () => {
    expect(isWithinQuietHours(DEFAULT_QUIET_HOURS, new Date('2026-03-10T23:30:00.000Z'))).toBe(false);
  });

  it('detects a window that wraps midnight', () => {
    const quiet = { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'UTC' };
    expect(isWithinQuietHours(quiet, new Date('2026-03-10T23:30:00.000Z'))).toBe(true);
    expect(isWithinQuietHours(quiet, new Date('2026-03-10T03:00:00.000Z'))).toBe(true);
    expect(isWithinQuietHours(quiet, new Date('2026-03-10T12:00:00.000Z'))).toBe(false);
  });

  it('handles a same-day window and a zero-length window', () => {
    const dayWindow = { enabled: true, startMinute: 9 * 60, endMinute: 17 * 60, timezone: 'UTC' };
    expect(isWithinQuietHours(dayWindow, new Date('2026-03-10T10:00:00.000Z'))).toBe(true);
    expect(isWithinQuietHours(dayWindow, new Date('2026-03-10T18:00:00.000Z'))).toBe(false);

    const zeroLength = { enabled: true, startMinute: 60, endMinute: 60, timezone: 'UTC' };
    expect(isWithinQuietHours(zeroLength, new Date('2026-03-10T01:00:00.000Z'))).toBe(false);
  });

  it('computes when quiet hours end, or null when not inside them', () => {
    const quiet = { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'UTC' };
    const inside = new Date('2026-03-10T23:00:00.000Z');
    expect(nextQuietHoursEnd(quiet, inside)?.toISOString()).toBe('2026-03-11T07:00:00.000Z');
    expect(nextQuietHoursEnd(quiet, new Date('2026-03-10T12:00:00.000Z'))).toBeNull();
  });
});

describe('CommunicationPreferenceService.resolveRoutes', () => {
  it('orders enabled channels by the category waterfall', async () => {
    const { service } = makeService();
    const route = await service.resolveRoutes('user-1', 'security', {
      email: 'a@b.c',
      push: 'device-1',
      sms: '+15550001111',
    });

    expect(route.channels).toEqual(['email', 'push', 'sms']);
    expect(route.deferred).toBe(false);
  });

  it('skips a channel with no contact point', async () => {
    const { service } = makeService();
    const route = await service.resolveRoutes('user-1', 'security', { email: 'a@b.c' });

    expect(route.channels).toEqual(['email']);
    expect(route.decisions).toContainEqual({
      channel: 'sms',
      allowed: false,
      reason: 'missing_contact_point',
    });
  });

  it('honours a hard channel opt-out even when the category is enabled', async () => {
    const { service } = makeService();
    await service.optOutChannel('user-1', 'sms', 'replied STOP');

    const route = await service.resolveRoutes('user-1', 'security', {
      email: 'a@b.c',
      sms: '+15550001111',
    });

    expect(route.channels).toEqual(['email']);
    expect(route.decisions).toContainEqual({ channel: 'sms', allowed: false, reason: 'opted_out' });
  });

  it('defers every channel while quiet hours are active', async () => {
    const { service } = makeService(new Date('2026-03-10T23:00:00.000Z'));
    await service.updatePreferences('user-1', {
      quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'UTC' },
    });

    const route = await service.resolveRoutes('user-1', 'billing', { email: 'a@b.c' });
    expect(route.channels).toEqual([]);
    expect(route.deferred).toBe(true);
    expect(route.deferUntil).toBe('2026-03-11T07:00:00.000Z');
  });

  it('reports no_enabled_channel when every channel is off', async () => {
    const { service } = makeService();
    await service.updatePreferences('user-1', {
      categories: { marketing: { email: false, in_app: false } },
    });

    const route = await service.resolveRoutes('user-1', 'marketing', { email: 'a@b.c' });
    expect(route.channels).toEqual([]);
    expect(route.decisions.some((d) => d.reason === 'no_enabled_channel')).toBe(true);
  });
});
