export interface UserNotificationSchedule {
  timezone: string;
  quietHours?: { start: number; end: number };
  days?: number[];
}

/** Client-side guard used before displaying a scheduled push notification. */
export function isNotificationDeliveryAllowed(
  schedule: UserNotificationSchedule | undefined,
  now = new Date(),
): boolean {
  if (!schedule) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const quiet = schedule.quietHours;
  const inQuiet = quiet && (quiet.start === quiet.end || (quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end));
  return (!schedule.days || schedule.days.includes(day)) && !inQuiet;
}
