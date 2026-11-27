import {
  clearDateFormatterCache,
  createDateHelpers,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayKey,
  formatMonthYear,
  formatRelativeDay,
  getFormatter,
  isSameDay,
  toDate,
  toIntlLocale,
  DEFAULT_DATE_OPTIONS,
} from '../index';

const ISO = '2026-11-23T12:00:00.000Z';

describe('@subtrackr/i18n-dates', () => {
  afterEach(() => clearDateFormatterCache());

  describe('toIntlLocale', () => {
    it('expands short aliases to a region tag', () => {
      expect(toIntlLocale('es')).toBe('es-ES');
      expect(toIntlLocale('pt')).toBe('pt-BR');
    });

    it('keeps a fully qualified tag', () => {
      expect(toIntlLocale('fr-CA')).toBe('fr-CA');
    });

    it('falls back for empty or invalid input', () => {
      expect(toIntlLocale()).toBe('en-US');
      expect(toIntlLocale('   ')).toBe('en-US');
      expect(toIntlLocale('not a locale!')).toBe('en-US');
    });
  });

  describe('toDate', () => {
    it('accepts Date, ISO string and epoch millis', () => {
      const expected = Date.parse(ISO);
      expect(toDate(new Date(ISO))?.getTime()).toBe(expected);
      expect(toDate(ISO)?.getTime()).toBe(expected);
      expect(toDate(expected)?.getTime()).toBe(expected);
    });

    it('returns null for unusable input', () => {
      expect(toDate(undefined)).toBeNull();
      expect(toDate(null)).toBeNull();
      expect(toDate('not-a-date')).toBeNull();
      expect(toDate(new Date('nope'))).toBeNull();
    });
  });

  describe('formatter cache', () => {
    it('reuses the same Intl instance for identical arguments', () => {
      const first = getFormatter('en-US', 'UTC', DEFAULT_DATE_OPTIONS);
      const second = getFormatter('en-US', 'UTC', DEFAULT_DATE_OPTIONS);
      expect(first).toBe(second);
    });

    it('returns a fresh instance after clearing the cache', () => {
      const first = getFormatter('en-US', 'UTC', DEFAULT_DATE_OPTIONS);
      clearDateFormatterCache();
      const second = getFormatter('en-US', 'UTC', DEFAULT_DATE_OPTIONS);
      expect(first).not.toBe(second);
      expect(second.format(new Date(ISO))).toBe(first.format(new Date(ISO)));
    });

    it('falls back to the host zone for an unknown time zone', () => {
      const formatter = getFormatter('en-US', 'Not/AZone', DEFAULT_DATE_OPTIONS);
      expect(formatter.format(new Date(ISO))).not.toBe('');
    });
  });

  describe('formatDate', () => {
    it('formats a calendar date in the requested locale', () => {
      expect(formatDate(ISO, 'en-US', DEFAULT_DATE_OPTIONS, 'UTC')).toBe('Nov 23, 2026');
    });

    it('returns an empty string for invalid input instead of throwing', () => {
      expect(formatDate('not-a-date')).toBe('');
      expect(formatDate(null)).toBe('');
    });

    it('honours the time zone boundary', () => {
      const late = '2026-11-23T23:30:00.000Z';
      expect(formatDate(late, 'en-US', DEFAULT_DATE_OPTIONS, 'UTC')).toBe('Nov 23, 2026');
      expect(formatDate(late, 'en-US', DEFAULT_DATE_OPTIONS, 'Asia/Tokyo')).toBe('Nov 24, 2026');
    });
  });

  describe('formatDateTime and formatMonthYear', () => {
    it('renders date plus time', () => {
      const value = formatDateTime(ISO, 'en-US', undefined, 'UTC');
      expect(value).toContain('Nov 23, 2026');
      expect(value).toMatch(/12:00/);
    });

    it('renders a month heading', () => {
      expect(formatMonthYear(ISO, 'en-US', undefined, 'UTC')).toBe('November 2026');
    });
  });

  describe('formatDayKey', () => {
    it('produces a sortable day key', () => {
      expect(formatDayKey(ISO, 'UTC')).toBe('2026-11-23');
    });

    it('is empty for invalid input', () => {
      expect(formatDayKey('nope')).toBe('');
    });
  });

  describe('isSameDay', () => {
    it('compares calendar days in the given zone', () => {
      expect(isSameDay('2026-11-23T01:00:00Z', '2026-11-23T22:00:00Z', 'UTC')).toBe(true);
      expect(isSameDay('2026-11-23T23:30:00Z', '2026-11-24T00:30:00Z', 'UTC')).toBe(false);
    });

    it('is false when either side is invalid', () => {
      expect(isSameDay(ISO, 'nope')).toBe(false);
    });
  });

  describe('formatDateRange', () => {
    it('collapses a same-day range to one date', () => {
      expect(
        formatDateRange('2026-11-23T01:00:00Z', '2026-11-23T22:00:00Z', 'en-US', DEFAULT_DATE_OPTIONS, 'UTC'),
      ).toBe('Nov 23, 2026');
    });

    it('joins two distinct dates with an en dash', () => {
      expect(
        formatDateRange('2026-11-01T12:00:00Z', '2026-11-05T12:00:00Z', 'en-US', DEFAULT_DATE_OPTIONS, 'UTC'),
      ).toBe('Nov 1, 2026 \u2013 Nov 5, 2026');
    });

    it('degrades to the single valid end', () => {
      expect(formatDateRange('nope', ISO, 'en-US', DEFAULT_DATE_OPTIONS, 'UTC')).toBe('Nov 23, 2026');
    });
  });

  describe('formatRelativeDay', () => {
    const now = '2026-11-23T12:00:00.000Z';
    const base = { locale: 'en-US', timeZone: 'UTC', now };

    it('labels the current day', () => {
      expect(formatRelativeDay(now, base)).toBe('Today');
    });

    it('labels adjacent days', () => {
      expect(formatRelativeDay('2026-11-22T09:00:00Z', base)).toBe('Yesterday');
      expect(formatRelativeDay('2026-11-24T09:00:00Z', base)).toBe('Tomorrow');
    });

    it('counts days in both directions', () => {
      expect(formatRelativeDay('2026-11-20T09:00:00Z', base)).toBe('3 days ago');
      expect(formatRelativeDay('2026-11-25T09:00:00Z', base)).toBe('In 2 days');
    });

    it('accepts translated labels', () => {
      expect(
        formatRelativeDay('2026-11-22T09:00:00Z', {
          ...base,
          labels: { yesterday: 'Ayer', daysAgo: 'hace {days} dias' },
        }),
      ).toBe('Ayer');
    });

    it('returns an empty string for invalid input', () => {
      expect(formatRelativeDay('nope', base)).toBe('');
    });
  });

  describe('createDateHelpers', () => {
    it('binds locale and zone for every helper', () => {
      const dates = createDateHelpers({ locale: 'es', timeZone: 'UTC' });
      expect(dates.locale).toBe('es-ES');
      expect(dates.formatDate(ISO)).toContain('2026');
      expect(dates.formatDayKey(ISO)).toBe('2026-11-23');
      expect(dates.isSameDay(ISO, ISO)).toBe(true);
      expect(dates.formatRelativeDay(ISO, { now: ISO })).toBe('Today');
    });

    it('keeps helpers independent per configuration', () => {
      const utc = createDateHelpers({ locale: 'en-US', timeZone: 'UTC' });
      const tokyo = createDateHelpers({ locale: 'en-US', timeZone: 'Asia/Tokyo' });
      const late = '2026-11-23T23:30:00.000Z';
      expect(utc.formatDate(late)).toBe('Nov 23, 2026');
      expect(tokyo.formatDate(late)).toBe('Nov 24, 2026');
    });
  });
});
