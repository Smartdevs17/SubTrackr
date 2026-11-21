/** Time-zone helpers based on IANA zones and the host's Intl database. */

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  FORMATTER_CACHE.set(timeZone, created);
  return created;
}

/** Extract local calendar fields for an instant. Invalid zones fall back to UTC. */
export function zonedDateTimeParts(instant: Date, timeZone = 'UTC'): ZonedDateTimeParts {
  const date = validDate(instant);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter(timeZone).formatToParts(date);
  } catch {
    parts = formatter('UTC').formatToParts(date);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '0';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')) % 24,
    minute: Number(value('minute')),
    second: Number(value('second')),
    weekday: weekdays[value('weekday')] ?? date.getUTCDay(),
  };
}

export function localMinutesOfDay(instant: Date, timeZone = 'UTC'): number {
  const parts = zonedDateTimeParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function localHourOf(instant: Date, timeZone = 'UTC'): number {
  return zonedDateTimeParts(instant, timeZone).hour;
}

/** Offset east of UTC in milliseconds at the supplied instant. */
export function timeZoneOffsetMs(instant: Date, timeZone = 'UTC'): number {
  const date = validDate(instant);
  const local = zonedDateTimeParts(date, timeZone);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return localAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a local wall-clock time on the instant's local day into a later instant. */
export function utcInstantForLocalHour(instant: Date, hour: number, timeZone = 'UTC'): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('hour must be an integer from 0 to 23');
  }
  const local = zonedDateTimeParts(validDate(instant), timeZone);
  let result = utcInstantForLocalDateTime(local.year, local.month, local.day, hour, 0, timeZone);
  if (result.getTime() <= instant.getTime()) {
    const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    result = utcInstantForLocalDateTime(
      nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), hour, 0, timeZone,
    );
  }
  return result;
}

/** Convert local calendar fields into an instant, accounting for DST offsets. */
export function utcInstantForLocalDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = 'UTC',
): Date {
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    !Number.isInteger(year) || year < 100 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > maxDay ||
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59
  ) {
    throw new RangeError('local date and time fields are out of range');
  }
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = desired - timeZoneOffsetMs(new Date(candidate), timeZone);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

/** Format an instant for display in an IANA zone; invalid zones fall back to UTC. */
export function formatInTimeZone(
  instant: Date,
  timeZone: string,
  locale = 'en-US',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  const date = validDate(instant);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** Stable YYYY-MM-DD calendar key in a timezone; invalid zones fall back to UTC. */
export function dayKeyInTimeZone(instant: Date, timeZone = 'UTC'): string {
  const { year, month, day } = zonedDateTimeParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isDaylightSavingTransitionWithin(
  instant: Date,
  timeZone: string,
  horizonMs = 7 * 24 * 60 * 60 * 1000,
): boolean {
  const date = validDate(instant);
  return timeZoneOffsetMs(date, timeZone) !== timeZoneOffsetMs(new Date(date.getTime() + horizonMs), timeZone);
}

function validDate(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError('instant must be a valid Date');
  }
  return date;
}
