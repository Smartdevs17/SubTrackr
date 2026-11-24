import {
  formatMobileDate,
  formatMobileDateTime,
  formatMobileShortDate,
  formatRelativeDay,
  mobileDates,
} from '../date';

const ISO = '2026-11-25T12:00:00Z';

describe('mobile/src/lib/date', () => {
  it('formats a calendar date for the app', () => {
    expect(formatMobileDate(ISO, 'en-US')).toBe('Nov 25, 2026');
  });

  it('formats a compact reminder date pinned to the UTC charge day', () => {
    expect(formatMobileShortDate('2026-11-25T23:30:00Z', 'en-US')).toBe('Nov 25');
    expect(formatMobileShortDate('2026-11-26T00:30:00Z', 'en-US')).toBe('Nov 26');
  });

  it('includes the time when asked', () => {
    const value = formatMobileDateTime(ISO, 'en-US');
    expect(value).toContain('2026');
    expect(value).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns an empty string instead of leaking a raw ISO string', () => {
    expect(formatMobileDate('not-a-date')).toBe('');
    expect(formatMobileShortDate('not-a-date')).toBe('');
    expect(formatMobileDateTime('not-a-date')).toBe('');
  });

  it('respects the requested locale', () => {
    expect(formatMobileDate(ISO, 'es')).toContain('2026');
    expect(formatMobileDate(ISO, 'es')).not.toBe(formatMobileDate(ISO, 'en-US'));
  });

  it('exposes helpers bound to the app defaults', () => {
    expect(mobileDates.locale).toBe('en-US');
    expect(mobileDates.formatDate(ISO)).toBe('Nov 25, 2026');
  });

  it('labels recent days relative to an injected clock', () => {
    const now = '2026-11-25T12:00:00Z';
    expect(formatRelativeDay(now, { locale: 'en-US', now })).toBe('Today');
    expect(formatRelativeDay('2026-11-23T12:00:00Z', { locale: 'en-US', now })).toBe(
      '2 days ago',
    );
  });
});
