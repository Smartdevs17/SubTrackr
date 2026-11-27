/**
 * packages/i18n-dates
 *
 * One locale-aware date formatter shared by the web portal (`src/`) and the
 * React Native app (`mobile/`). The module is framework-agnostic on purpose:
 * it only touches `Intl` and plain `Date` values so both surfaces and the
 * backend can import it without pulling in React or React Native.
 *
 * Issue #2259.
 */

export type DateInput = Date | string | number;

export interface DateFormatterConfig {
  /** BCP-47 tag or a short alias such as `es`, `pt-BR` or `en`. */
  locale?: string;
  /** IANA zone. Unknown zones fall back to the host zone. */
  timeZone?: string;
  /** Default `Intl.DateTimeFormatOptions` for every helper. */
  options?: Intl.DateTimeFormatOptions;
}

export interface RelativeDayLabels {
  today: string;
  yesterday: string;
  tomorrow: string;
  /** `{days}` is replaced with the absolute number of days. */
  daysAgo: string;
  inDays: string;
}

export const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

export const DEFAULT_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DEFAULT_DATE_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
};

export const DEFAULT_MONTH_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
};

export const DEFAULT_RELATIVE_LABELS: RelativeDayLabels = {
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  daysAgo: '{days} days ago',
  inDays: 'In {days} days',
};

export const FALLBACK_LOCALE = 'en-US';

/** Short aliases used across the product that `Intl` alone will not resolve. */
const LOCALE_ALIASES: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  nl: 'nl-NL',
  pt: 'pt-BR',
  pl: 'pl-PL',
  ru: 'ru-RU',
  tr: 'tr-TR',
  ar: 'ar',
  he: 'he',
  hi: 'hi-IN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Normalise a locale to a tag `Intl` accepts, falling back to `en-US`. */
export function toIntlLocale(locale?: string | null): string {
  const raw = typeof locale === 'string' ? locale.trim() : '';
  if (!raw) return FALLBACK_LOCALE;
  const lower = raw.toLowerCase();
  // A fully qualified tag (with a region or script subtag) is authoritative;
  // only bare language codes are expanded through the alias table.
  const alias = lower.includes('-') ? undefined : LOCALE_ALIASES[lower];
  const candidate = alias ?? raw;
  try {
    // Throws for structurally invalid tags such as "not a locale".
    Intl.DateTimeFormat.supportedLocalesOf(candidate);
    return candidate;
  } catch {
    return FALLBACK_LOCALE;
  }
}

/** Coerce any accepted input into a valid `Date`, or `null` when unusable. */
export function toDate(value: DateInput | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cacheKey(locale: string, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): string {
  return `${locale}|${timeZone ?? ''}|${JSON.stringify(options)}`;
}

/**
 * Return a cached `Intl.DateTimeFormat`. Invalid time zones fall back to the
 * host zone instead of throwing, so a bad user preference never breaks render.
 */
export function getFormatter(
  locale?: string,
  timeZone?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
): Intl.DateTimeFormat {
  const tag = toIntlLocale(locale);
  const key = cacheKey(tag, timeZone, options);
  const cached = formatterCache.get(key);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(tag, { ...options, ...(timeZone ? { timeZone } : {}) });
  } catch {
    formatter = new Intl.DateTimeFormat(tag, options);
  }
  formatterCache.set(key, formatter);
  return formatter;
}

/** Drop cached formatters. Intended for tests and locale switches. */
export function clearDateFormatterCache(): void {
  formatterCache.clear();
}

function formatWith(
  value: DateInput | null | undefined,
  locale: string | undefined,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (!date) return '';
  try {
    return getFormatter(locale, timeZone, options).format(date);
  } catch {
    // Last resort: ISO-8601 is unambiguous even when `Intl` is unavailable.
    return date.toISOString();
  }
}

/** Localised calendar date, e.g. `Nov 23, 2026`. Invalid input yields `''`. */
export function formatDate(
  value: DateInput | null | undefined,
  locale?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
  timeZone?: string,
): string {
  return formatWith(value, locale, timeZone, options);
}

/** Localised date and time, e.g. `Nov 23, 2026, 09:30`. */
export function formatDateTime(
  value: DateInput | null | undefined,
  locale?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATETIME_OPTIONS,
  timeZone?: string,
): string {
  return formatWith(value, locale, timeZone, options);
}

/** Localised month and year, e.g. `November 2026`. */
export function formatMonthYear(
  value: DateInput | null | undefined,
  locale?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_MONTH_OPTIONS,
  timeZone?: string,
): string {
  return formatWith(value, locale, timeZone, options);
}

/** Localised ISO-style day key (`2026-11-23`) useful for list grouping. */
export function formatDayKey(value: DateInput | null | undefined, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return '';
  try {
    const parts = getFormatter('en-CA', timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** True when both instants land on the same calendar day in `timeZone`. */
export function isSameDay(
  a: DateInput | null | undefined,
  b: DateInput | null | undefined,
  timeZone?: string,
): boolean {
  const left = formatDayKey(a, timeZone);
  const right = formatDayKey(b, timeZone);
  return left !== '' && left === right;
}

/** `Jan 1 - Jan 5, 2026`; collapses to a single date when both ends match. */
export function formatDateRange(
  start: DateInput | null | undefined,
  end: DateInput | null | undefined,
  locale?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
  timeZone?: string,
): string {
  const from = formatDate(start, locale, options, timeZone);
  const to = formatDate(end, locale, options, timeZone);
  if (!from) return to;
  if (!to || isSameDay(start, end, timeZone)) return from;
  return `${from} \u2013 ${to}`;
}

export interface FormatRelativeDayOptions extends DateFormatterConfig {
  /** Reference instant, defaults to now. */
  now?: DateInput;
  labels?: Partial<RelativeDayLabels>;
}

/**
 * Human-friendly day label: `Today`, `Yesterday`, `3 days ago`, `In 2 days`,
 * then the localised date for anything further away.
 */
export function formatRelativeDay(
  value: DateInput | null | undefined,
  config: FormatRelativeDayOptions = {},
): string {
  const date = toDate(value);
  if (!date) return '';

  const labels: RelativeDayLabels = { ...DEFAULT_RELATIVE_LABELS, ...config.labels };
  const zone = config.timeZone;
  const now = toDate(config.now) ?? new Date();

  const diffDays = Math.round(
    (Date.parse(`${formatDayKey(now, zone)}T00:00:00Z`) -
      Date.parse(`${formatDayKey(date, zone)}T00:00:00Z`)) /
      MS_PER_DAY,
  );

  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  if (diffDays === -1) return labels.tomorrow;
  if (diffDays > 1) return labels.daysAgo.replace('{days}', String(diffDays));
  if (diffDays < -1) return labels.inDays.replace('{days}', String(Math.abs(diffDays)));

  return formatDate(date, config.locale, config.options ?? DEFAULT_DATE_OPTIONS, zone);
}

export interface DateHelpers {
  readonly locale: string;
  readonly timeZone?: string;
  formatDate: (value: DateInput | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: DateInput | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatMonthYear: (value: DateInput | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatDayKey: (value: DateInput | null | undefined) => string;
  formatDateRange: (
    start: DateInput | null | undefined,
    end: DateInput | null | undefined,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatRelativeDay: (value: DateInput | null | undefined, options?: FormatRelativeDayOptions) => string;
  isSameDay: (a: DateInput | null | undefined, b: DateInput | null | undefined) => boolean;
}

/**
 * Bind a locale and zone once so screens do not thread them through every
 * call site. Returned helpers keep the module's pure-function semantics.
 */
export function createDateHelpers(config: DateFormatterConfig = {}): DateHelpers {
  const locale = toIntlLocale(config.locale);
  const { timeZone } = config;
  const defaultOptions = config.options ?? DEFAULT_DATE_OPTIONS;

  return {
    locale,
    timeZone,
    formatDate: (value, options = defaultOptions) => formatDate(value, locale, options, timeZone),
    formatDateTime: (value, options = DEFAULT_DATETIME_OPTIONS) =>
      formatDateTime(value, locale, options, timeZone),
    formatMonthYear: (value, options = DEFAULT_MONTH_OPTIONS) =>
      formatMonthYear(value, locale, options, timeZone),
    formatDayKey: (value) => formatDayKey(value, timeZone),
    formatDateRange: (start, end, options = defaultOptions) =>
      formatDateRange(start, end, locale, options, timeZone),
    formatRelativeDay: (value, options = {}) =>
      formatRelativeDay(value, { locale, timeZone, options: defaultOptions, ...options }),
    isSameDay: (a, b) => isSameDay(a, b, timeZone),
  };
}
