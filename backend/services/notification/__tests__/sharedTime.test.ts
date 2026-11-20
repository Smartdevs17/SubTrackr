import { describe, expect, it } from '@jest/globals';
import {
  dayKeyInTimeZone,
  formatInTimeZone,
  isDaylightSavingTransitionWithin,
  localHourOf,
  localMinutesOfDay,
  timeZoneOffsetMs,
  utcInstantForLocalDateTime,
  utcInstantForLocalHour,
  zonedDateTimeParts,
} from '../../../../shared/time';

describe('shared timezone utilities', () => {
  it('reads local parts without depending on the host timezone', () => {
    const instant = new Date('2026-03-01T21:30:45.000Z');
    expect(zonedDateTimeParts(instant, 'Europe/Berlin')).toEqual({
      year: 2026, month: 3, day: 1, hour: 22, minute: 30, second: 45, weekday: 0,
    });
    expect(localHourOf(instant, 'Europe/Berlin')).toBe(22);
    expect(localMinutesOfDay(instant, 'Europe/Berlin')).toBe(22 * 60 + 30);
  });

  it('converts local times using the offset in effect on the requested date', () => {
    expect(utcInstantForLocalHour(new Date('2026-07-01T00:00:00Z'), 8, 'Europe/Berlin').toISOString())
      .toBe('2026-07-01T06:00:00.000Z');
    expect(utcInstantForLocalHour(new Date('2026-03-01T00:00:00Z'), 8, 'Europe/Berlin').toISOString())
      .toBe('2026-03-01T07:00:00.000Z');
    expect(utcInstantForLocalDateTime(2026, 3, 2, 8, 30, 'Europe/Berlin').toISOString())
      .toBe('2026-03-02T07:30:00.000Z');
  });

  it('moves to tomorrow when the requested local hour has already passed', () => {
    expect(utcInstantForLocalHour(new Date('2026-03-01T09:00:00Z'), 8, 'Europe/Berlin').toISOString())
      .toBe('2026-03-02T07:00:00.000Z');
  });

  it('falls back to UTC for invalid zones consistently', () => {
    const instant = new Date('2026-03-01T23:30:00.000Z');
    expect(localHourOf(instant, 'Not/AZone')).toBe(23);
    expect(localMinutesOfDay(instant, 'Not/AZone')).toBe(23 * 60 + 30);
    expect(dayKeyInTimeZone(instant, 'Not/AZone')).toBe('2026-03-01');
    expect(timeZoneOffsetMs(instant, 'Not/AZone')).toBe(0);
    expect(formatInTimeZone(instant, 'Not/AZone', 'en-CA', { timeZoneName: 'short' })).toContain('UTC');
  });

  it('detects offset transitions within the configured horizon', () => {
    expect(isDaylightSavingTransitionWithin(new Date('2026-03-22T12:00:00Z'), 'Europe/Berlin')).toBe(true);
    expect(isDaylightSavingTransitionWithin(new Date('2026-02-01T12:00:00Z'), 'Europe/Berlin')).toBe(false);
  });

  it('rejects invalid dates and local-hour values', () => {
    expect(() => localHourOf(new Date(Number.NaN), 'UTC')).toThrow('valid Date');
    expect(() => utcInstantForLocalHour(new Date(), 24, 'UTC')).toThrow(RangeError);
    expect(() => utcInstantForLocalDateTime(2026, 2, 30, 8, 0, 'UTC')).toThrow(RangeError);
  });
});
