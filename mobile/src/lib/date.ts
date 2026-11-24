/**
 * mobile/src/lib/date.ts
 *
 * Issue #2259: the React Native app's single entry point for date formatting.
 * The rules live in `packages/i18n-dates` so the portal and the app can never
 * drift apart again; this module only supplies mobile defaults (the device
 * zone, unless a caller passes one explicitly).
 */

import {
  DEFAULT_DATE_OPTIONS,
  DEFAULT_DATETIME_OPTIONS,
  createDateHelpers,
  formatDate,
  formatDateTime,
  type DateInput,
} from '../../../packages/i18n-dates';

export * from '../../../packages/i18n-dates';

/** Helpers bound to the app's default locale and the device time zone. */
export const mobileDates = createDateHelpers({ locale: 'en-US' });

/** Calendar date in the device zone, e.g. `Nov 23, 2026`. */
export function formatMobileDate(value: DateInput | null | undefined, locale = 'en-US'): string {
  return formatDate(value, locale, DEFAULT_DATE_OPTIONS);
}

/** Date and time in the device zone, e.g. `Nov 23, 2026, 09:30`. */
export function formatMobileDateTime(value: DateInput | null | undefined, locale = 'en-US'): string {
  return formatDateTime(value, locale, DEFAULT_DATETIME_OPTIONS);
}

/**
 * Compact date used in dense rows and banners, e.g. `23 Nov`. Reminder dates
 * describe the UTC calendar day a charge lands on, so the zone stays pinned.
 */
export function formatMobileShortDate(
  value: DateInput | null | undefined,
  locale = 'en-US',
  timeZone = 'UTC',
): string {
  return formatDate(value, locale, { day: 'numeric', month: 'short' }, timeZone);
}
