/**
 * Issue #1744 (UTC-scheduled pushes, quiet hours with timezone) and #1746
 * (digest windows) — tests for the push schedule engine.
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import {
  PushScheduleEngine,
  isWithinQuietHoursDate,
  nextQuietHoursEnd,
  localHourOf,
  utcInstantForLocalHour,
  digestWindowFor,
  DigestBuilder,
  type QuietHoursWindow,
} from '../pushScheduleEngine';

const BERLIN: QuietHoursWindow = {
  enabled: true,
  startHour: 22,
  endHour: 8,
  timezone: 'Europe/Berlin',
};
const UTC_QUIET: QuietHoursWindow = {
  enabled: true,
  startHour: 22,
  endHour: 8,
  timezone: 'UTC',
};

afterEach(() => {
  jest.useRealTimers();
});

describe('quiet hours with a configured timezone (#1744)', () => {
  it('treats 23:30 UTC as inside a 22→8 UTC window', () => {
    expect(isWithinQuietHoursDate(new Date('2026-03-01T23:30:00.000Z'), UTC_QUIET)).toBe(true);
  });

  it('treats 12:00 UTC as outside a 22→8 UTC window', () => {
    expect(isWithinQuietHoursDate(new Date('2026-03-01T12:00:00.000Z'), UTC_QUIET)).toBe(false);
  });

  it('reads the window in the subscriber timezone, not UTC', () => {
    // 22:00 Berlin on 2026-03-01 = 21:00 UTC (CET, UTC+1) → 21:30 UTC is inside,
    // even though 21 would be outside a 22→8 UTC window.
    expect(isWithinQuietHoursDate(new Date('2026-03-01T21:30:00.000Z'), BERLIN)).toBe(true);
    // 20:30 UTC = 21:30 Berlin → outside.
    expect(isWithinQuietHoursDate(new Date('2026-03-01T20:30:00.000Z'), BERLIN)).toBe(false);
  });

  it('defers a delivery to the end of the local quiet window', () => {
    // 22:30 Berlin (21:30 UTC) → next quiet end is 08:00 Berlin on Mar 2
    // = 07:00 UTC (still CET).
    const at = new Date('2026-03-01T21:30:00.000Z');
    expect(nextQuietHoursEnd(at, BERLIN).toISOString()).toBe('2026-03-02T07:00:00.000Z');
  });

  it('returns the delivery time unchanged outside quiet hours', () => {
    const at = new Date('2026-03-01T12:00:00.000Z');
    expect(nextQuietHoursEnd(at, UTC_QUIET).getTime()).toBe(at.getTime());
  });

  it('crosses DST boundaries with the correct UTC offset (Berlin)', () => {
    // CEST (UTC+2) in July: 08:00 local → 06:00 UTC.
    expect(
      utcInstantForLocalHour(new Date('2026-07-01T00:00:00.000Z'), 8, 'Europe/Berlin').toISOString()
    ).toBe('2026-07-01T06:00:00.000Z');
    // CET (UTC+1) in March: 08:00 local → 07:00 UTC.
    expect(
      utcInstantForLocalHour(new Date('2026-03-01T00:00:00.000Z'), 8, 'Europe/Berlin').toISOString()
    ).toBe('2026-03-01T07:00:00.000Z');
  });

  it('localHourOf returns the wall-clock hour of a UTC instant', () => {
    expect(localHourOf(new Date('2026-03-01T21:30:00.000Z'), 'Europe/Berlin')).toBe(22);
    expect(localHourOf(new Date('2026-03-01T23:30:00.000Z'), 'UTC')).toBe(23);
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(localHourOf(new Date('2026-03-01T23:30:00.000Z'), 'Not/AZone')).toBe(23);
  });
});

describe('PushScheduleEngine.schedule (#1744)', () => {
  const engine = new PushScheduleEngine();

  it('delivers at the current UTC instant when outside quiet hours', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

    const out = engine.schedule(
      'me',
      'informative',
      'billing',
      'Netflix renews',
      'Tomorrow',
      UTC_QUIET,
      ['billing']
    );

    expect(out).not.toBeNull();
    expect(out!.deliverAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('defers a non-critical notification to the quiet-hours end (UTC)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T23:30:00.000Z'));

    const out = engine.schedule(
      'me',
      'informative',
      'billing',
      'Netflix renews',
      'Tomorrow',
      UTC_QUIET,
      ['billing']
    );

    expect(out).not.toBeNull();
    expect(out!.deliverAt).toBe('2026-03-02T08:00:00.000Z');
  });

  it('defers using the subscriber timezone (Europe/Berlin)', () => {
    // 21:30 UTC = 22:30 Berlin → inside the Berlin quiet window.
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T21:30:00.000Z'));

    const out = engine.schedule(
      'me',
      'informative',
      'billing',
      'Spotify renews',
      'Tomorrow',
      BERLIN,
      ['billing']
    );

    expect(out).not.toBeNull();
    expect(out!.deliverAt).toBe('2026-03-02T07:00:00.000Z');
  });

  it('bypasses quiet hours for critical notifications', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T23:30:00.000Z'));

    const out = engine.schedule(
      'me',
      'critical',
      'security',
      'Suspicious sign-in',
      'Check your account',
      UTC_QUIET,
      ['billing', 'security']
    );

    expect(out).not.toBeNull();
    expect(out!.deliverAt).toBe('2026-03-01T23:30:00.000Z');
  });

  it('drops non-critical notifications the subscriber has not opted into', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

    const out = engine.schedule(
      'me',
      'marketing',
      'marketing',
      '20% off',
      'Upgrade today',
      UTC_QUIET,
      ['billing']
    );

    expect(out).toBeNull();
  });
});

describe('digest windows (#1746)', () => {
  it('uses 09:00 UTC today when the daily window has not passed', () => {
    expect(digestWindowFor('daily', new Date('2026-03-01T07:00:00.000Z')).toISOString()).toBe(
      '2026-03-01T09:00:00.000Z'
    );
  });

  it('uses 09:00 UTC on the next day once the daily window has passed', () => {
    expect(digestWindowFor('daily', new Date('2026-03-01T10:00:00.000Z')).toISOString()).toBe(
      '2026-03-02T09:00:00.000Z'
    );
  });

  it('uses the next Monday 09:00 UTC for a weekly digest', () => {
    // 2026-03-01 is a Sunday → next day is Monday Mar 2.
    expect(digestWindowFor('weekly', new Date('2026-03-01T10:00:00.000Z')).toISOString()).toBe(
      '2026-03-02T09:00:00.000Z'
    );
    // A Monday before the window rolls to the following Monday.
    expect(digestWindowFor('weekly', new Date('2026-03-02T10:00:00.000Z')).toISOString()).toBe(
      '2026-03-09T09:00:00.000Z'
    );
  });
});

describe('DigestBuilder (#1746)', () => {
  it('groups pending items into one digest entry and clears the buffer', () => {
    const b = new DigestBuilder();
    b.enqueue('me', 'Netflix renews', 'Plan goes up to $15.99', 'billing');
    b.enqueue('me', 'Spotify renews', 'Annual renewal on Friday', 'billing');
    expect(b.getPendingCount('me')).toBe(2);

    const entry = b.buildDigest('me', 'daily');
    expect(entry).not.toBeNull();
    expect(entry!.notifications).toHaveLength(2);
    expect(entry!.notifications[0]).toMatchObject({ title: 'Netflix renews', category: 'billing' });
    expect(entry!.frequency).toBe('daily');
    expect(b.getPendingCount('me')).toBe(0);
  });

  it('returns null when nothing is buffered', () => {
    expect(new DigestBuilder().buildDigest('me', 'daily')).toBeNull();
  });
});
